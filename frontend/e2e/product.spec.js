import { test, expect } from '@playwright/test';
import process from 'node:process';
import { readFile } from 'node:fs/promises';

test('Web Vitals export only anonymous metric fields',async({page,context})=>{
  const samples=[];
  await context.route('**/api/v1/browser-vitals',async(route)=>{
    const headers={'Access-Control-Allow-Origin':'http://127.0.0.1:4174','Access-Control-Allow-Credentials':'true',
      'Access-Control-Allow-Headers':'content-type','Access-Control-Allow-Methods':'POST,OPTIONS'};
    if(route.request().method()==='POST') samples.push(route.request().postDataJSON());
    await route.fulfill({status:204,headers});
  });
  await page.goto('/');
  await expect(page.getByRole('heading',{name:/See the game/})).toBeVisible();
  await page.waitForFunction(()=>performance.getEntriesByType('resource').some((entry)=>entry.name.includes('web-vitals')));
  await page.waitForTimeout(600);
  // Headless Edge keeps background tabs visible; exercise the visibility hook.
  await page.evaluate(()=>{
    Object.defineProperty(document,'visibilityState',{value:'hidden',configurable:true});
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(()=>samples.length).toBeGreaterThan(0);
  for(const sample of samples) {
    expect(Object.keys(sample).sort()).toEqual(['device','id','name','route','value']);
    expect(sample.route).toBe('home');
    expect(['LCP','INP','CLS']).toContain(sample.name);
    expect(sample.value).toBeGreaterThanOrEqual(0);
  }
});

test('saved study restores game history and report export preserves citations',async({page})=>{
  let studies=[];
  await page.route('**/api/v1/**',async(route)=>{
    const request=route.request(), path=new URL(request.url()).pathname;
    const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'};
    if(request.method()==='OPTIONS') return route.fulfill({status:204,headers});
    if(path==='/api/v1/players') return route.fulfill({headers,json:{players:[{name:'Alice',games:3}]}});
    if(path==='/api/v1/studies') {
      if(request.method()==='POST') { const study={...request.postDataJSON(),id:'test-study',created_at:new Date().toISOString()}; studies=[study]; return route.fulfill({status:201,headers,json:study}); }
      return route.fulfill({headers,json:{studies}});
    }
    if(path==='/api/v1/studies/test-study') {studies=[];return route.fulfill({status:204,headers,body:''});}
    if(path==='/api/v1/predict-move') return route.fulfill({headers,json:{san_move:'e5',confidence:.3,matching_games:0,engine:{status:'unavailable'}}});
    if(path==='/api/v1/predict-strategy/stream') return route.fulfill({headers,contentType:'application/x-ndjson',body:JSON.stringify({type:'complete',result:{
      opponent:'Alice',supporting_games:1,available_games:3,statistics:[{id:'sample',type:'sample',games:3,game_ids:['g1']}],
      sources:[{id:'g1',white:'Alice',black:'Bob',pgn:'1. e4 e5 *'}],
      report:{profile:[{text:'Cited claim',confidence:'supported',source_game_ids:['g1'],statistic_ids:['sample']}],tendencies:[],weaknesses:[],recommendations:[],limitations:['Small sample']},
    }})+'\n'});
    return route.fulfill({status:204,headers,body:''});
  });
  await page.goto('/predict');
  await expect(page.getByLabel('Opponent',{exact:true})).toHaveValue('Alice');
  await page.getByLabel('Play a move (SAN or UCI)').fill('e4');
  await page.getByRole('button',{name:'Play move',exact:true}).click();
  await expect(page.getByText(/Game history \/ PGN \(2 plies\)/)).toBeVisible();
  await page.getByLabel('Study name').fill('Opening notes');
  await page.getByRole('button',{name:'Save study',exact:true}).click();
  await expect(page.getByText('Study saved.',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Reset game',exact:true}).click();
  await page.reload();
  await page.getByRole('button',{name:'Open study Opening notes'}).click();
  await expect(page.getByText(/Game history \/ PGN \(2 plies\)/)).toBeVisible();
  await page.getByRole('button',{name:'Generate opponent report'}).click();
  await expect(page.getByText('Cited claim',{exact:true})).toBeVisible();
  const downloadPromise=page.waitForEvent('download');
  await page.getByRole('button',{name:'Export report',exact:true}).click();
  const download=await downloadPromise;
  const markdown=await readFile(await download.path(),'utf8');
  for(const text of ['Cited claim','g1','sample','Small sample','1. e4 e5 *']) expect(markdown).toContain(text);
  await page.getByRole('button',{name:'Delete study Opening notes'}).click();
  await expect(page.getByRole('button',{name:'Open study Opening notes'})).toHaveCount(0);
});

test('signed JWT browser flow saves privately and rejects a second identity',async({page,request})=>{
  const base=process.env.BROWSER_TEST_API;
  test.skip(!base,'Start the explicit local browser API test profile first.');
  const owner=(await (await request.get(`${base}/_test/session?owner=0`)).json());
  const other=(await (await request.get(`${base}/_test/session?owner=1`)).json());
  await page.addInitScript((token)=>{window.__browserTestToken=token;},owner.token);
  await page.route('**/api/v1/**',async(route)=>{
    const url=new URL(route.request().url());
    const response=await route.fetch({url:`${base}${url.pathname}${url.search}`});
    await route.fulfill({response});
  });
  await page.goto('/predict');
  await expect(page.getByLabel('Opponent',{exact:true})).not.toHaveValue('');
  const name=`Signed study ${Date.now()}`;
  await page.getByLabel('Study name').fill(name);
  await page.getByRole('button',{name:'Save study',exact:true}).click();
  await expect(page.getByRole('button',{name:`Open study ${name}`})).toBeVisible();
  const ownStudies=(await (await request.get(`${base}/api/v1/studies`,{headers:{Authorization:`Bearer ${owner.token}`}})).json()).studies;
  const saved=ownStudies.find((study)=>study.title===name);
  const others=await request.get(`${base}/api/v1/studies`,{headers:{Authorization:`Bearer ${other.token}`}});
  expect((await others.json()).studies.some((study)=>study.id===saved.id)).toBeFalsy();
  expect((await request.delete(`${base}/api/v1/studies/${saved.id}`,{headers:{Authorization:`Bearer ${other.token}`}})).status()).toBe(404);
  await page.getByRole('button',{name:`Delete study ${name}`}).click();
  await expect(page.getByRole('button',{name:`Open study ${name}`})).toHaveCount(0);
});
