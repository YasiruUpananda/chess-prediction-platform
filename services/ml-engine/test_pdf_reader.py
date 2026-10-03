import asyncio
import hashlib
import io
import os
import time
import unittest
from uuid import uuid4
from unittest.mock import patch

import pymupdf as fitz
import httpx
from PIL import Image
import main
import ocr_jobs
from database import connect


class ImageBoundsTests(unittest.TestCase):
    def test_dimensions_rejected_before_queueing(self):
        output=io.BytesIO()
        Image.new('RGB',(9000,1),'white').save(output,format='PNG')
        with patch.object(ocr_jobs,'submit') as submit:
            with self.assertRaisesRegex(ValueError,'dimensions'):
                ocr_jobs.submit_image('owner',1,output.getvalue())
            submit.assert_not_called()

    def test_pixel_limit_and_image_format_are_enforced(self):
        output=io.BytesIO()
        Image.new('RGB',(100,100),'white').save(output,format='PNG')
        with patch.dict(os.environ,{'OCR_MAX_PIXELS':'9999'}):
            with self.assertRaisesRegex(ValueError,'dimensions'):
                ocr_jobs.submit_image('owner',1,output.getvalue())
        with self.assertRaises(OSError):
            ocr_jobs.submit_image('owner',1,b'not an image')


@unittest.skipUnless(os.getenv('RUN_INTEGRATION_TESTS')=='1','Requires Compose services')
class PageImageTests(unittest.TestCase):
    def setUp(self):
        self.owner='pdf-test-'+str(uuid4())
        self.other=self.owner+'-other'

    def tearDown(self):
        main.app.dependency_overrides.clear()
        with connect() as db:
            db.execute('DELETE FROM ocr_jobs WHERE owner=ANY(%s)',([self.owner,self.other],))
            db.execute('DELETE FROM request_limits WHERE owner=ANY(%s)',
                       ([hashlib.sha256(owner.encode()).hexdigest() for owner in (self.owner,self.other)],))

    def image(self):
        with fitz.open() as doc:
            page=doc.new_page(width=500,height=150)
            page.insert_text((30,60),'1. e4 e5 2. Nf3 Nc6',fontsize=24)
            return page.get_pixmap(dpi=200).tobytes('png')

    def test_selected_image_ocr_is_cached_and_owner_scoped(self):
        content=self.image()
        first=ocr_jobs.submit_image(self.owner,7,content)
        duplicate=ocr_jobs.submit_image(self.owner,7,content)
        self.assertEqual(first['job_id'],duplicate['job_id'])
        self.assertTrue(duplicate['cached'])
        self.assertIsNone(ocr_jobs.get(first['job_id'],self.other))
        other=ocr_jobs.submit_image(self.other,7,content)
        self.assertNotEqual(first['job_id'],other['job_id'])
        deadline=time.monotonic()+60
        while time.monotonic()<deadline:
            result=ocr_jobs.get(first['job_id'],self.owner)
            if result['status'] in ('completed','failed'): break
            time.sleep(.25)
        self.assertEqual(result['status'],'completed',result)
        self.assertIn('Nf3',result['result']['text'])
        self.assertTrue(result['result']['text_items'])
        self.assertGreater(result['result']['ocr_confidence'],0)
        self.assertEqual(ocr_jobs.submit_image(self.owner,7,content)['status'],'completed')
        with connect() as db:
            self.assertIsNone(db.execute('SELECT pdf FROM ocr_jobs WHERE id=%s',(first['job_id'],)).fetchone()[0])

    def test_image_endpoint_requires_auth_and_valid_images(self):
        async def check():
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app),base_url='http://test') as client:
                payload={'page':'1'}
                files={'file':('page.png',self.image(),'image/png')}
                self.assertEqual((await client.post('/api/v1/extract-page-image',data=payload,files=files)).status_code,401)
                main.app.dependency_overrides[main.require_asgardeo_user]=lambda: {'sub':self.owner}
                invalid=await client.post('/api/v1/extract-page-image',data=payload,files={'file':('page.png',b'bad','image/png')})
                self.assertEqual(invalid.status_code,400)
                with patch.dict(os.environ,{'OCR_QUEUE_LIMIT':'0'}):
                    busy=await client.post('/api/v1/extract-page-image',data=payload,files=files)
                    self.assertEqual(busy.status_code,429)
                result=await client.post('/api/v1/extract-page-image',data=payload,files=files)
                self.assertEqual(result.status_code,202,result.text)
                self.assertIn('job_id',result.json())
                main.app.dependency_overrides[main.require_asgardeo_user]=lambda: {'sub':self.other}
                self.assertEqual((await client.get('/api/v1/ocr-jobs/'+result.json()['job_id'])).status_code,404)
        asyncio.run(check())

    def test_line_crop_recovers_complete_notation(self):
        content=self.image()
        job=ocr_jobs.submit_image(self.owner,1,content,'line')
        deadline=time.monotonic()+60
        while time.monotonic()<deadline:
            result=ocr_jobs.get(job['job_id'],self.owner)
            if result['status'] in ('completed','failed'): break
            time.sleep(.25)
        self.assertEqual(result['status'],'completed',result)
        self.assertEqual(result['result']['moves'],['e4','e5','Nf3','Nc6'])


if __name__=='__main__': unittest.main()

class RegionOcrTests(unittest.TestCase):
    def test_segmentation_modes_are_explicit_and_cached_separately(self):
        content=io.BytesIO();Image.new('L',(100,40),255).save(content,format='PNG')
        with patch.object(ocr_jobs,'submit',return_value={}) as submit:
            keys=[]
            for mode in ('page','block','line'):
                ocr_jobs.submit_image('owner',1,content.getvalue(),mode)
                args=submit.call_args.args;keys.append(args[3])
                if mode!='page':
                    with Image.open(io.BytesIO(args[2])) as image:
                        self.assertEqual(image.info['ocr_mode'],mode)
            self.assertEqual(len(set(keys)),3)
            with self.assertRaises(ValueError):ocr_jobs.submit_image('owner',1,content.getvalue(),'99')

    def test_unreadable_symbols_are_not_guessed_as_queens(self):
        import tempfile
        import ocr_extract
        data={'text':['1.e4','e5','2.\ufffdf3','Nc6'],'conf':[95]*4,'left':[0]*4,'top':[0]*4,
              'width':[20]*4,'height':[10]*4,'block_num':[1]*4,'par_num':[1]*4,'line_num':[1]*4}
        with tempfile.NamedTemporaryFile(suffix='.png') as output:
            Image.new('L',(100,40),255).save(output.name)
            with patch.object(ocr_extract.pytesseract,'image_to_data',return_value=data) as recognize:
                result=ocr_extract.extract(output.name,1)
            self.assertNotIn('Qf3',result['moves'])
            self.assertNotIn('f3',result['moves'])
            self.assertIn('\ufffdf3',result['text'])
            self.assertEqual(recognize.call_args.kwargs['config'],'--psm 3')

    def test_region_segmentation_is_used_with_bounded_deskew(self):
        import ocr_extract
        data={'text':[]}
        with patch.object(ocr_extract.pytesseract,'image_to_data',return_value=data) as recognize:
            ocr_extract.image_ocr(Image.new('L',(100,40),255),'line')
            self.assertEqual(recognize.call_args.kwargs['config'],'--psm 7')
