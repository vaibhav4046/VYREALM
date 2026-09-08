"""Offline CPU speech transcription with VAD. Never writes synthetic captions."""
import argparse, hashlib, json, os, pathlib, time
os.environ['HF_HUB_OFFLINE']='1'
os.environ['TRANSFORMERS_OFFLINE']='1'
os.environ['HF_HUB_DISABLE_TELEMETRY']='1'
parser=argparse.ArgumentParser()
parser.add_argument('--request',required=True)
parser.add_argument('--output',required=True)
parser.add_argument('--config',required=True)
args=parser.parse_args()
request=json.loads(pathlib.Path(args.request).read_text(encoding='utf-8'))
config=json.loads(pathlib.Path(args.config).read_text(encoding='utf-8'))
output=pathlib.Path(args.output);output.mkdir(parents=True,exist_ok=True)
for item in config['files']:
    if hashlib.sha256(pathlib.Path(item['path']).read_bytes()).hexdigest()!=item['sha256']:
        raise RuntimeError('LOCAL_AUDIO_MODEL_INTEGRITY_FAILED')
started=time.time()
from faster_whisper import WhisperModel
model=WhisperModel(config['whisper'],device='cpu',compute_type='int8',cpu_threads=4,num_workers=1,local_files_only=True)
segments,info=model.transcribe(request['inputPath'],language='en',beam_size=3,word_timestamps=True,
    vad_filter=True,vad_parameters={'threshold':0.65,'min_silence_duration_ms':500},
    condition_on_previous_text=False,no_speech_threshold=0.6)
rows=[]
for segment in segments:
    if segment.no_speech_prob>0.6 or segment.avg_logprob < -1.0 or segment.compression_ratio>2.4:
        continue
    rows.append({'start':segment.start,'end':segment.end,'text':segment.text.strip(),
      'words':[{'start':word.start,'end':word.end,'word':word.word,'probability':word.probability} for word in segment.words or []]})
result={'status':'review_required','validated':True,'segments':rows,'captionStatus':'transcribed' if rows else 'no-speech',
  'provenance':{'providerId':'faster-whisper-local-cpu','modelId':'tiny.en','device':'cpu','vadEnabled':True,
    'language':'en','renderTimeMs':round((time.time()-started)*1000),'sourceHash':hashlib.sha256(pathlib.Path(request['inputPath']).read_bytes()).hexdigest()}}
(output/'result.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
