-- CreateTable
CREATE TABLE "turma_disciplinas" (
    "turma_id" INTEGER NOT NULL,
    "disciplina_id" INTEGER NOT NULL,

    CONSTRAINT "turma_disciplinas_pkey" PRIMARY KEY ("turma_id","disciplina_id")
);

-- CreateIndex
CREATE INDEX "turma_disciplinas_disciplina_id_idx" ON "turma_disciplinas"("disciplina_id");

-- AddForeignKey
ALTER TABLE "turma_disciplinas" ADD CONSTRAINT "turma_disciplinas_turma_id_fkey" FOREIGN KEY ("turma_id") REFERENCES "turmas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turma_disciplinas" ADD CONSTRAINT "turma_disciplinas_disciplina_id_fkey" FOREIGN KEY ("disciplina_id") REFERENCES "disciplinas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: monta o currículo das turmas existentes a partir do que já está em uso
-- (disciplinas com professor vinculado na turma + disciplinas com notas de alunos da turma).
INSERT INTO "turma_disciplinas" ("turma_id", "disciplina_id")
SELECT "turma_id", "disciplina_id" FROM "turma_disciplina_professor"
UNION
SELECT a."turma_id", n."disciplina_id"
FROM "notas" n
JOIN "alunos" a ON a."id" = n."aluno_id"
ON CONFLICT DO NOTHING;
