ALTER TABLE "models"
ADD COLUMN "part_count" INTEGER NOT NULL DEFAULT 0;

UPDATE "models"
SET "part_count" = CASE
  WHEN jsonb_typeof("parts_json") = 'array' THEN COALESCE((
    SELECT SUM(
      CASE
        WHEN jsonb_typeof(item -> 'quantity') = 'number' THEN (item ->> 'quantity')::INTEGER
        WHEN COALESCE(item ->> 'quantity', '') ~ '^[0-9]+$' THEN (item ->> 'quantity')::INTEGER
        ELSE 0
      END
    )
    FROM jsonb_array_elements("parts_json") AS item
  ), 0)
  ELSE 0
END;
