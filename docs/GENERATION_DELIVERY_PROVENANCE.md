# Generated source and encoded delivery

Neural shot receipts distinguish the provider-generated source clip from its 1080p Lanczos delivery:

| Field | Meaning |
| --- | --- |
| `provenance.source` | Original native-source provider evidence, including its source output hash/path, workflow, model, seed and provider frame lineage |
| `provenance.sourceHash` / `sourceOutputPath` | Exact bytes and job-relative path of the native source MP4 |
| `provenance.outputHash` / `outputPath` | Exact bytes and job-relative path of `outputs.video`, the 1080p delivery MP4 |
| `provenance.resolution` | Native generation resolution |
| `provenance.deliveryResolution` | Encoded delivery resolution |
| `provenance.deliveryMethod` | Explicit `1080p-lanczos-from-WIDTHxHEIGHT` resize |
| `provenance.evidenceHash` / `evidenceScope` | Original provider audit, scoped to the generated source |
| `provenance.deliveryEvidenceHash` | Hash binding the source audit/hash to delivery bytes and delivery verification |

`generationStatus: "generated"` describes the locally generated source origin. It does not claim that the model generated native 1080p detail. Enhanced 4K output remains `generationStatus: "upscaled"` and uses the native source evidence/hash rather than the intermediate 1080p delivery.

`bindGeneratedDelivery` verifies that both files resolve within the same job, the source bytes and path match their existing provider receipt, the delivery fully decodes, and dimensions/timing/frame count match. First, middle and last decoded delivery frames are compared against a Lanczos resize of the hash-verified source. This sampled lineage check rejects unrelated delivery media; it does not replace cinematic quality or complete temporal review.

For receipts written by an already-running older worker, call:

```js
const updated = await normalizeLegacyDelivery({ jobRoot, receipt });
```

The function verifies files and returns a new receipt without modifying the input object or writing files. A caller can atomically persist it at a completed-job boundary. Normalizing a receipt that is already bound requires its delivery hash to remain unchanged; a changed file is rejected rather than silently rehashed. Legacy receipts without separate delivery hashes must still pass source ownership/hash checks, full decode, timing and sampled lineage verification.

Run `node --test runtime/generation-delivery.test.mjs`. Tests use explicitly synthetic video fixtures, never evidence of real model generation or catalogue assets. They cover separate hashes, pure migration, altered bytes, outside-job files, copied wrong-source paths, unrelated playable 1080p media, corruption, and enhancement consuming only the native source.
