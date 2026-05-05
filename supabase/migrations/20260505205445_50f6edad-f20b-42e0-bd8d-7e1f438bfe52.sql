UPDATE products SET image_bboxes = (
  SELECT jsonb_agg(
    CASE
      WHEN jsonb_typeof(box) = 'array'
       AND jsonb_array_length(box) = 4
       AND (box->>0)::numeric >= 0 AND (box->>0)::numeric <= 1
       AND (box->>1)::numeric >= 0 AND (box->>1)::numeric <= 1
       AND (box->>2)::numeric > 0  AND (box->>2)::numeric <= 1
       AND (box->>3)::numeric > 0  AND (box->>3)::numeric <= 1
      THEN box
      ELSE '[0,0,1,1]'::jsonb
    END
  )
  FROM jsonb_array_elements(image_bboxes) AS box
)
WHERE jsonb_typeof(image_bboxes) = 'array'
  AND jsonb_array_length(image_bboxes) > 0
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(image_bboxes) AS box
    WHERE jsonb_typeof(box) <> 'array'
       OR jsonb_array_length(box) <> 4
       OR (box->>0)::numeric < 0 OR (box->>0)::numeric > 1
       OR (box->>1)::numeric < 0 OR (box->>1)::numeric > 1
       OR (box->>2)::numeric <= 0 OR (box->>2)::numeric > 1
       OR (box->>3)::numeric <= 0 OR (box->>3)::numeric > 1
  );