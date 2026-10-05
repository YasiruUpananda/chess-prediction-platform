import {test,expect} from '@playwright/test';

test('report references paginate without bloating the report and reject stale evidence',async({page})=>{
  const offsets=[];
  await page.route('**/api/v1/**',route=>{
    const url=new URL(route.request().url());
    const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'};
    if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
    if(url.pathname.endsWith('/players'))return route.fulfill({headers,json:{players:[{name:'Alice',games:60}]}});
    if(url.pathname.endsWith('/studies'))return route.fulfill({headers,json:{studies:[]}});
    if(url.pathname.endsWith('/predict-strategy/stream'))return route.fulfill({headers,contentType:'application/x-ndjson',body:JSON.stringify({type:'complete',result:{
      opponent:'Alice',color:'any',context:'',data_version:'v1',available_games:60,supporting_games:1,
      statistics:[{id:'sample',type:'sample',games:60,game_ids:['g0','g1','g2','g3','g4','g5']}],sources:[],
      report:{profile:[{text:'Supported qualitative interpretation',confidence:'supported',statistic_ids:['sample'],source_game_ids:[]}],
        tendencies:[],weaknesses:[],recommendations:[],limitations:['Limited supplied corpus']}}})+'\n'});
    if(url.pathname.endsWith('/evidence/references')){
      const offset=Number(url.searchParams.get('offset'));offsets.push(offset);
      expect(url.searchParams.get('version')).toBe('v1');expect(url.searchParams.get('limit')).toBe('25');
      if(offset===50)return route.fulfill({status:409,headers,json:{detail:'Evidence changed. Refresh the report before browsing references.'}});
      return route.fulfill({headers,json:{total:60,offset,limit:25,data_version:'v1',games:Array.from({length:25},(_,index)=>({id:`game-${offset+index}`,white:'Alice',black:'Bob'}))}});
    }
    return route.fulfill({status:404,headers,json:{detail:'Unexpected request'}});
  });
  await page.goto('/predict');await expect(page.getByLabel('Opponent',{exact:true})).toHaveValue('Alice');
  await page.getByRole('button',{name:'Generate opponent report'}).click();
  await expect(page.getByText('Supported qualitative interpretation',{exact:true})).toBeVisible();
  await page.getByText('Source game references',{exact:true}).click();
  await expect(page.getByText('Showing 6 sample references of 60 games.')).toBeVisible();
  await page.getByRole('button',{name:'Browse all references',exact:true}).click();
  await expect(page.getByText('game-24',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Next references',exact:true}).click();
  await expect(page.getByText('game-49',{exact:true})).toBeVisible();
  await expect(page.getByText('game-0',{exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Next references',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Evidence changed');
  expect(offsets).toEqual([0,25,50]);
});
