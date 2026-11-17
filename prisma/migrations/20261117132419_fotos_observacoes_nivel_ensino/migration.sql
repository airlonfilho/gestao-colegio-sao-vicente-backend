-- AlterTable
ALTER TABLE "alunos" ADD COLUMN     "foto" TEXT;

-- AlterTable
ALTER TABLE "usuarios" ADD COLUMN     "foto" TEXT;

-- CreateTable
CREATE TABLE "observacoes_boletim" (
    "id" SERIAL NOT NULL,
    "aluno_id" INTEGER NOT NULL,
    "ano_letivo" INTEGER NOT NULL,
    "periodo" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "observacoes_boletim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "observacoes_boletim_aluno_id_ano_letivo_periodo_key" ON "observacoes_boletim"("aluno_id", "ano_letivo", "periodo");

-- AddForeignKey
ALTER TABLE "observacoes_boletim" ADD CONSTRAINT "observacoes_boletim_aluno_id_fkey" FOREIGN KEY ("aluno_id") REFERENCES "alunos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Padroniza o nível de ensino com as opções da tela: Infantil, Fundamental I, Fundamental II, Ensino Médio.
UPDATE "turmas" SET "nivel_ensino" = 'Fundamental II' WHERE "nivel_ensino" IN ('Ensino Fundamental II', 'Fundamental 2');
UPDATE "turmas" SET "nivel_ensino" = 'Fundamental I'  WHERE "nivel_ensino" IN ('Ensino Fundamental I', 'Fundamental 1');
UPDATE "turmas" SET "nivel_ensino" = 'Infantil'       WHERE "nivel_ensino" IN ('Educação Infantil', 'Ensino Infantil');
