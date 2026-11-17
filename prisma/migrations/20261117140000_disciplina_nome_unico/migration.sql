-- Nome de disciplina único, ignorando maiúsculas, acentos e espaços extras.
-- A normalização abaixo precisa bater com normalizarNome() em src/utils/texto.ts.

ALTER TABLE "disciplinas" ADD COLUMN "nome_normalizado" TEXT;

CREATE FUNCTION pg_temp.normalizar_nome(t TEXT) RETURNS TEXT AS $$
  SELECT regexp_replace(
    btrim(translate(lower(t),
      'áàâãäåéèêëíìîïóòôõöúùûüçñý',
      'aaaaaaeeeeiiiiooooouuuucny')),
    '\s+', ' ', 'g')
$$ LANGUAGE SQL IMMUTABLE;

-- Duplicatas existentes: mantém a de menor id e renomeia as outras com o id entre parênteses
-- (ex.: "Português (6)"). Nada é apagado; o admin pode juntar manualmente depois.
WITH ranqueadas AS (
  SELECT id, row_number() OVER (PARTITION BY pg_temp.normalizar_nome(nome) ORDER BY id) AS ordem
  FROM "disciplinas"
)
UPDATE "disciplinas" d
SET "nome" = d."nome" || ' (' || d.id || ')'
FROM ranqueadas r
WHERE r.id = d.id AND r.ordem > 1;

UPDATE "disciplinas" SET "nome_normalizado" = pg_temp.normalizar_nome("nome");

ALTER TABLE "disciplinas" ALTER COLUMN "nome_normalizado" SET NOT NULL;

CREATE UNIQUE INDEX "disciplinas_nome_normalizado_key" ON "disciplinas"("nome_normalizado");
