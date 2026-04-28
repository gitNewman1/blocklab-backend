CREATE TABLE "recommended_models" (
  "id" SERIAL PRIMARY KEY,
  "set_number" VARCHAR(20) NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "series" VARCHAR(50),
  "part_count" INTEGER NOT NULL,
  "price" DECIMAL(10,2) NOT NULL,
  "age_rating" VARCHAR(10),
  "description" TEXT,
  "cover_url" TEXT NOT NULL,
  "display_url" TEXT NOT NULL,
  "detail_urls" TEXT[] NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "recommended_models_created_at_idx" ON "recommended_models"("created_at" DESC);
