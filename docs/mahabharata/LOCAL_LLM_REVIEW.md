# Local model editorial pass and bounded repair

The VYREALM repository harness `scripts/mahabharata-plan.mjs` invoked the installed `qwen3:4b-instruct` through Ollama at `127.0.0.1:11434`. This was a real local inference, with no hosted API. The model was supplied source-grounded research; it did not browse the web.

The inference took 176.48 seconds wall time, completed 659 output tokens and returned six shot descriptions. Settings were a 4,096-token context, seed 73519, temperature 0.2, `num_gpu: 0`, a 1,800-token output ceiling and `keep_alive: 0`. A concurrent read of Ollama `/api/ps` reported `size_vram: 0` and model allocation 2,900,969,388 bytes. This is a runtime allocation report, not a full process peak-RAM measurement.

- Exact model digest: `0edcdef34593eac1aa2be9c7d06c432dcf81945adca5eca2f27662c18f168ba0`.
- Exact HTTP response SHA-256: `06e2798a1b8c77de624be3baeed36ca104e03ffac2dcbc615826b7b22708b359`.
- Complete request, response, source hashes and timings: `local-llm-evidence.json`.

The narration field contained only `At Kuruksh`, two words rather than the required 48–58. The request completed with a normal stop, so the narration cannot be treated as a successfully written script. A generated accuracy note also incorrectly asserted that dawn was described in scripture; the provided research explicitly labelled it a lighting choice. Shot actions mostly restated the supplied plan and did not justify replacing the richer approved shot briefs.

The structured word-count gate rejected this draft. Editorial review also rejected the unsupported dawn assertion. The local model's exact failed output remains preserved for improving the engine.

The response used 1,026 prompt tokens and 659 generated tokens, below both the 4,096 context and 1,800 output budgets; `done_reason` was `stop`. There is no evidence that a token ceiling truncated the two-word narration. Template inspection found a Qwen ChatML/Jinja conversation template and normal message-end stop sequences; the different template representation from the other installed Qwen aliases is not by itself evidence of a broken template.

One bounded repair pass narrows the task to narration alone, with concise grounded facts, 45–65 words, at most three accuracy notes and a 768-token output ceiling. It uses the same CPU-only model, preserving the first attempt. Run it with `node scripts/mahabharata-plan.mjs --repair-narration`. Separate evidence and draft filenames prevent it from overwriting the failed response. Until that output passes structural and editorial review, the original 51-word research-grounded narration and six-shot plan remain authoritative.

The initial pass is a demonstrated local inference with a failed script-quality gate; it is not evidence of a generated film or a successful automatic writing result.

## Repair result and selected revision

The narrowed request completed in **37.90 seconds**, using 269 prompt tokens and 157 generated tokens. It produced a coherent 72-word narration, preserved verbatim in `local-llm-repair-draft.json`. That exceeded the 45–65-word bound. It also said Arjuna stopped the chariot; the researched source has him ask Krishna to place it between the armies. Its sentence framing Krishna's speech risked reading as invented direct dialogue, and the closing contrast of strength, love and fear simplified his moral conflict.

The draft was therefore structurally rejected as delivered, then shortened and corrected through an explicit editorial revision. The selected **49-word** narration is in `narration-approved.txt` and `production-script.json` revision 2. It preserves the local draft's concrete progression of chariot, kin, breath, slipping bow and counsel, while correcting agency and avoiding invented quoted scripture. The final text is **local-model-assisted, editorially revised**, not unmodified LLM output. Its writing provenance is separate from the still-pending visual-generation provenance.

Repair response SHA-256: `c89ed6b2cae48342dc83afee5eda746782729bbf42b66a595ccb6ff1baca43b4`. The exact prompt, model digest, template hash, raw response and timing are in `local-llm-repair-evidence.json`. Both passes used CPU-only settings and unloaded the model after completion.

## Narration timing revision 5

The current approved text is 44 words. It replaces the earlier 49-word editorial revision after local Piper measured an opening cue at 5.28 seconds, longer than its five-second shot. The shorter pilot fit all six slots; the final revision also names Arjuna in the second cue to remove an ambiguous pronoun. Its exact final text still requires a fresh project-owned voiceover job. Pilot audio is verification material, not a completed film soundtrack. Editorial changes do not become model-generated writing through this timing check.
