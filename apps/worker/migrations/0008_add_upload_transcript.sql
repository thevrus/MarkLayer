-- A voice note's transcript, written by the first successful POST /f/:id/transcribe and
-- served back on every later one, so a repeat call never reruns the model. NULL = not
-- transcribed yet; an empty string is a note that held no speech.
ALTER TABLE uploads ADD COLUMN transcript TEXT;
