ALTER TABLE "configuracoes" ALTER COLUMN "cobranca_automatica" SET DEFAULT true;
UPDATE "configuracoes" SET "cobranca_automatica" = true, "atualizado_em" = CURRENT_TIMESTAMP
WHERE "id" = 1 AND NOT "cobranca_automatica";
