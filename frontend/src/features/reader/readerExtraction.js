import {textBlocks,regionBlocks} from './chessPdf';
import {waitForPoll} from '../../lib/api';
import {extractPageImage,getOcrJob} from '../../lib/apiClient';

export async function extractDocumentPage({pdfDocument,pageNumber,selection,forceOCR,ocrMode,getAccessToken,controller,onStatus,onRender}) {
  let canvas,renderTask,extracted;
  const setMoveStatus=onStatus;
  try {
          const page = await pdfDocument.getPage(pageNumber);
          const content = await page.getTextContent();
          const viewport = page.getViewport({ scale: 1 });
          const blocks = regionBlocks(textBlocks(content.items, viewport.width, pageNumber),selection);
          const readableText = blocks.map((block) => block.text).join('\n');
          extracted = { blocks, source: 'PDF text', ocrConfidence: null };
          if (forceOCR || readableText.trim().length < 10) {
            // Cap dimensions before allocating a canvas. Only this page leaves the browser.
            if (!Number.isFinite(viewport.width * viewport.height) || viewport.width <= 0 || viewport.height <= 0 || Math.max(viewport.width, viewport.height) > 14400) {
              throw new Error('Page dimensions exceed the rendering limit.');
            }
            const scale = Math.min(200 / 72, 4000 / Math.max(viewport.width, viewport.height), Math.sqrt(12000000 / (viewport.width * viewport.height)));
            const imageViewport = page.getViewport({ scale });
            canvas = document.createElement('canvas');
            canvas.width = Math.ceil(imageViewport.width); canvas.height = Math.ceil(imageViewport.height);
            if(selection) {
              const points=[[selection.x,selection.y],[selection.x+selection.width,selection.y+selection.height]].map(([x,y])=>{
                const [a,b,c,d,e,f]=imageViewport.transform;return [a*x+c*y+e,b*x+d*y+f];
              });
              const left=Math.min(...points.map(point=>point[0])),top=Math.min(...points.map(point=>point[1]));
              canvas.width=Math.ceil(Math.abs(points[1][0]-points[0][0]));canvas.height=Math.ceil(Math.abs(points[1][1]-points[0][1]));
              renderTask=page.render({canvas,viewport:imageViewport,transform:[1,0,0,1,-left,-top]});
            } else renderTask = page.render({ canvas, viewport: imageViewport });
            onRender(renderTask);
            await renderTask.promise;
            if (controller.signal.aborted) return;
            const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
            canvas.width = 0; canvas.height = 0;
            if (!blob || blob.size > 8 * 1024 * 1024) throw new Error('Page image exceeds the 8 MB OCR upload limit.');
            const formData = new FormData(); formData.append('file', blob, 'page.png'); formData.append('page', String(pageNumber));formData.append('mode',selection?ocrMode:'page');
            let job = await extractPageImage(formData, {
              signal: controller.signal, getAccessToken, timeout: 30000,
            });
            const deadline = Date.now() + 3 * 60 * 1000;
            while (job.status === 'queued' || job.status === 'running') {
              if (Date.now() > deadline) throw new Error('OCR is taking too long. Try this page again later.');
              setMoveStatus(job.status === 'queued' ? 'Page queued for OCR...' : 'Reading this page image...');
              await waitForPoll(controller.signal);
              job = await getOcrJob(job.job_id, {
                signal: controller.signal, timeout: 10000, getAccessToken,
              });
            }
            if (job.status !== 'completed') throw new Error(job.error || 'OCR could not process this page.');
            const items = (job.result.text_items || []).map((item) => ({ ...item, transform: [1, 0, 0, item.height, item.x, -item.y] }));
            extracted = { blocks: items.length ? textBlocks(items, imageViewport.width, null) : [{ column: 1, text: job.result.text || '' }],
              source: 'Page image OCR', ocrConfidence: job.result.ocr_confidence };
          }

    return extracted;
  } finally { if(canvas){canvas.width=0;canvas.height=0;} }
}
