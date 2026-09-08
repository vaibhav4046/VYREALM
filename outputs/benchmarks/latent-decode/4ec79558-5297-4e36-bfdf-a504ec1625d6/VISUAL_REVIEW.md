# Decode fidelity review

Scope: one owned, already sampled five-second Wan latent. No new film generation, casting approval or catalogue admission.

Candidate video SHA256: `ffcaf37a26974b1daf24e1991216ab58aee75d54807d7471f9423b8342176917`.

I inspected the comparison contact sheet, all121 candidate frames and all121 retained standard frames in the ten `candidate-all-01..05.png` / `standard-all-01..05.png` sheets. Their last sheets contain one real frame and29 empty layout slots; those black slots are contact-sheet padding, not black video frames. I also inspected both native1024×576 versions of frame66, the frame with the lowest measured SSIM.

The candidate preserves the source woman's face shape, wet hair, jacket seams, bright background fixtures, shallow depth of field and gradual turn. No additional visible grid boundary or spatial tile seam was apparent. Frame66 shows no obvious extra face/cloth deformation or missing detail from tiled decoding. The gradual framing and background changes remain aligned across the compared frame sequences. This static all-frame review and adjacent-frame comparison are not an audiovisual playback assessment; the clip has no audio.

Across all121 decoded PNGs: SSIM mean0.997365, minimum0.996775; PSNR mean52.267dB, minimum50.01dB. Across120 adjacent pairs: mean luma difference5.063874 standard versus5.049586 tiled; maximum13.8666 versus13.8407. The aggregate temporal metric shows no increase relative to this source; it is not a general perceptual flicker detector.

Technical evidence: all121 generated descriptors/hashes retained; the delivered MP4 is120 frames,5.000 seconds,24fps,1024×576, H.264 High, and passed a full FFmpeg decode. Model sampling did not run. Provider decode182.689 seconds, full stage186.176 seconds, system-wide peak device memory2.661GiB, minimum system free RAM3.056GiB. Original standard decode timing was not isolated, so no numerical speedup ratio can be established.

Decision: **no visible added decode defects found for this single latent**. The experiment establishes a usable low-memory decode candidate on this Windows machine. It does not establish quality across all scenes or relative speed against a separately timed standard decode. Keep the runtime profile's general qualification unqualified and keep this output out of the film catalogue. The source's cinematic quality and action adherence are outside this review and were not upgraded.
