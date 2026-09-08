import argparse,hashlib,io,json,math,os,pathlib,time,wave
os.environ['HF_HUB_OFFLINE']='1';os.environ['TRANSFORMERS_OFFLINE']='1';os.environ['HF_HUB_DISABLE_TELEMETRY']='1'
p=argparse.ArgumentParser();p.add_argument('--request',required=True);p.add_argument('--output',required=True);p.add_argument('--config',required=True);a=p.parse_args()
request=json.loads(pathlib.Path(a.request).read_text(encoding='utf-8'));config=json.loads(pathlib.Path(a.config).read_text(encoding='utf-8'));output=pathlib.Path(a.output).resolve();output.mkdir(parents=True,exist_ok=True)
started=time.time()
def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()
for item in config['files']:
    if digest(pathlib.Path(item['path']))!=item['sha256']:raise RuntimeError('LOCAL_AUDIO_MODEL_INTEGRITY_FAILED')
def stamp(seconds):
    ms=round(seconds*1000);return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02},{ms%1000:03}'
operation=request['operation']
if operation=='voiceover':
    text=str(request.get('text','')).strip()
    if not text or len(text)>5000:raise RuntimeError('Voiceover requires 1–5000 characters')
    print(json.dumps({'progressEvent':True,'stage':'Synthesizing local narration with Piper','progress':0.2}),flush=True)
    from piper import PiperVoice,SynthesisConfig
    voice=PiperVoice.load(config['voice'],use_cuda=False)
    target=output/'narration.wav'
    cues=request.get('cues')
    cue_evidence=[]
    synthesis=SynthesisConfig(length_scale=1.05,noise_scale=0.5,noise_w_scale=0.7)
    if cues is None:
        with wave.open(str(target),'wb') as wav:voice.synthesize_wav(text,wav,synthesis)
    else:
        total=request.get('durationSeconds')
        if not isinstance(total,(int,float)) or not math.isfinite(total) or not 1<=total<=120 or not isinstance(cues,list) or not 1<=len(cues)<=24:raise RuntimeError('NARRATION_CUES_INVALID')
        previous=0; master=None; params=None
        for index,cue in enumerate(cues):
            start,end,words=cue.get('start'),cue.get('end'),str(cue.get('text','')).strip()
            if not isinstance(start,(int,float)) or not isinstance(end,(int,float)) or not math.isfinite(start) or not math.isfinite(end) or start<previous or end<=start or end>total or not words or len(words)>1000:raise RuntimeError('NARRATION_CUES_INVALID')
            buffer=io.BytesIO()
            with wave.open(buffer,'wb') as wav:voice.synthesize_wav(words,wav,synthesis)
            with wave.open(io.BytesIO(buffer.getvalue()),'rb') as wav:
                current=(wav.getnchannels(),wav.getsampwidth(),wav.getframerate()); count=wav.getnframes(); pcm=wav.readframes(count)
            if params is None:
                params=current; master=bytearray(round(total*params[2])*params[0]*params[1])
            if current!=params:raise RuntimeError('NARRATION_FORMAT_CHANGED')
            actual=count/params[2]
            if count>round((end-start)*params[2]):raise RuntimeError(f'NARRATION_CUE_OVERFLOW: cue {index+1} needs {actual:.2f}s but its shot allows {end-start:.2f}s. Shorten its narration.')
            offset=round(start*params[2])*params[0]*params[1]; master[offset:offset+len(pcm)]=pcm
            cue_evidence.append({'index':index,'start':start,'end':end,'text':words,'speechDurationSeconds':actual,'pcmHash':hashlib.sha256(pcm).hexdigest()});previous=end
        with wave.open(str(target),'wb') as wav:
            wav.setnchannels(params[0]);wav.setsampwidth(params[1]);wav.setframerate(params[2]);wav.writeframes(master)
    with wave.open(str(target),'rb') as wav:
        duration=wav.getnframes()/wav.getframerate();sample_rate=wav.getframerate();frames=wav.getnframes()
    if duration<=0 or frames==0:raise RuntimeError('EMPTY_LOCAL_NARRATION')
    result={'status':'review_required','validated':True,'durationSeconds':duration,'cues':cue_evidence,'outputs':{'audio':'narration.wav','quality':'audio-evidence.json'},'provenance':{'generationStatus':'generated','mediaType':'audio','providerId':'piper-local-cpu','modelId':'en_US-ljspeech-high','prompt':text,'modelHash':digest(pathlib.Path(config['voice'])),'outputHash':digest(target),'sampleRate':sample_rate,'renderTimeMs':round((time.time()-started)*1000),'timingMethod':'shot-aligned-local-speech' if cues is not None else 'continuous-local-speech'},'diagnostics':[{'code':'VOICE_REVIEW_REQUIRED','message':'Local narration created. Review pronunciation and timing; no lip-sync is implied.'}]}
else:
    if operation!='transcribe':raise RuntimeError('UNSUPPORTED_AUDIO_OPERATION')
    media=pathlib.Path(request['inputPath']).resolve()
    if not media.is_file():raise RuntimeError('TRANSCRIPTION_SOURCE_MISSING')
    print(json.dumps({'progressEvent':True,'stage':'Transcribing locally with Whisper tiny.en','progress':0.2}),flush=True)
    from faster_whisper import WhisperModel
    model=WhisperModel(config['whisper'],device='cpu',compute_type='int8',cpu_threads=4,num_workers=1,local_files_only=True)
    segments,info=model.transcribe(str(media),language='en',beam_size=3,word_timestamps=True,vad_filter=False)
    rows=[{'id':s.id,'start':round(s.start,3),'end':round(s.end,3),'text':s.text.strip(),'words':[{'start':w.start,'end':w.end,'word':w.word,'probability':w.probability} for w in (s.words or [])]} for s in segments]
    if not rows:raise RuntimeError('NO_SPEECH_DETECTED')
    (output/'captions.srt').write_text('\n\n'.join(f'{i+1}\n{stamp(s["start"])} --> {stamp(s["end"])}\n{s["text"]}' for i,s in enumerate(rows))+'\n',encoding='utf-8')
    result={'status':'review_required','validated':True,'segments':rows,'durationSeconds':info.duration,'outputs':{'captions':'captions.srt','quality':'audio-evidence.json'},'provenance':{'generationStatus':'transcribed','mediaType':'transcript','providerId':'faster-whisper-local-cpu','modelId':'tiny.en','sourceHash':digest(media),'outputHash':digest(output/'captions.srt'),'renderTimeMs':round((time.time()-started)*1000)},'diagnostics':[{'code':'TRANSCRIPT_REVIEW_REQUIRED','message':'Local speech recognition completed. Review words, names and timing; diarization is not enabled.'}]}
(output/'audio-evidence.json').write_text(json.dumps(result,indent=2),encoding='utf-8');(output/'result.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
