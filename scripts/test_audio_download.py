import hashlib
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('audio_setup', Path(__file__).with_name('install-audio-models.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class DownloadTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.data = b'local model fixture'
        self.item = {'repository': 'test/model', 'revision': 'pinned', 'file': 'm.bin', 'destination': 'm.bin', 'bytes': len(self.data), 'sha256': hashlib.sha256(self.data).hexdigest()}

    def response(self, data, status=200, headers=None):
        result = io.BytesIO(data)
        result.status, result.headers = status, headers or {}
        return result

    def test_corrupt_response_is_never_promoted(self):
        with self.assertRaises(ValueError):
            module.install_model(self.root, self.item, lambda *a, **k: self.response(b'x' * len(self.data)))
        self.assertFalse((self.root / 'm.bin').exists())
        self.assertTrue((self.root / 'm.bin.part').exists())

    def test_resume_then_offline_reuse(self):
        (self.root / 'm.bin.part').write_bytes(self.data[:5])
        def resume(request, **kwargs):
            self.assertEqual(request.headers['Range'], 'bytes=5-')
            return self.response(self.data[5:], 206, {'Content-Range': f'bytes 5-{len(self.data)-1}/{len(self.data)}'})
        target = module.install_model(self.root, self.item, resume)
        self.assertEqual(target.read_bytes(), self.data)
        module.install_model(self.root, self.item, lambda *a, **k: self.fail('Verified files must work offline'))

    def test_wrong_resume_range_preserves_partial(self):
        (self.root / 'm.bin.part').write_bytes(self.data[:5])
        with self.assertRaises(ValueError):
            module.install_model(self.root, self.item, lambda *a, **k: self.response(self.data[5:], 206, {'Content-Range': 'bytes 0-18/19'}))
        self.assertEqual((self.root / 'm.bin.part').read_bytes(), self.data[:5])


if __name__ == '__main__':
    unittest.main()
