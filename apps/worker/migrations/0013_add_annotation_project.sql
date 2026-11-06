-- The project a share link was promoted into, so the /s/ link that was sent
-- keeps opening every page. See annotationStore.linkProject for who gets one.
ALTER TABLE annotations ADD COLUMN project_id TEXT DEFAULT NULL;

-- One pass over live projects; an expired one would win the rank, then be cleared on first visit.
UPDATE annotations SET project_id = first.project_id
FROM (
  SELECT j.value AS page_id, p.id AS project_id,
         ROW_NUMBER() OVER (PARTITION BY j.value ORDER BY p.created_at, p.id) AS rank
  FROM projects p, json_each(p.page_ids) j
  WHERE p.expires_at IS NULL OR p.expires_at > unixepoch()
) AS first
WHERE first.page_id = annotations.id AND first.rank = 1
  AND annotations.access = 'edit' AND annotations.password_hash IS NULL;
