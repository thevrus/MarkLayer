-- Gates realtime editing in AnnotationRoom: 'edit' is today's behaviour
-- (anyone holding the id may draw); 'view' lets only the session matching
-- `owner_id` edit. `owner_expires_at` is its own column, not a reuse of
-- `expires_at`, because `annotationStore.put()`'s `ON CONFLICT ... SET
-- expires_at = excluded.expires_at` overwrites `expires_at` on every
-- anonymous re-save — an owner's choice has to survive that. Password
-- protection would be another column here (deferred).
ALTER TABLE annotations ADD COLUMN access TEXT NOT NULL DEFAULT 'edit';
ALTER TABLE annotations ADD COLUMN owner_expires_at INTEGER DEFAULT NULL;
