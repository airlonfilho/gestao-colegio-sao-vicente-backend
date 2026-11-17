-- Cobrança automática: configuração da escola, desconto/vencimento por aluno,
-- tipo de cobrança (mensalidade/matrícula), valor original + desconto e situação ISENTO.

-- CreateEnum
CREATE TYPE "TipoCobranca" AS ENUM ('MENSALIDADE', 'MATRICULA');

-- CreateEnum
CREATE TYPE "TipoDesconto" AS ENUM ('BOLSA_INTEGRAL', 'PERCENTUAL', 'VALOR');

-- AlterEnum
ALTER TYPE "StatusMensalidade" ADD VALUE 'ISENTO';

-- Aluno: dia de vencimento próprio e desconto. Alunos atuais ficam sem desconto e sem dia próprio (null).
ALTER TABLE "alunos" ADD COLUMN     "desconto_ate" TIMESTAMP(3),
ADD COLUMN     "dia_vencimento" INTEGER,
ADD COLUMN     "motivo_desconto" TEXT,
ADD COLUMN     "tipo_desconto" "TipoDesconto",
ADD COLUMN     "valor_desconto" DECIMAL(10,2);

-- Mensalidade: tipo, valor original e desconto.
-- Mensalidades existentes: tipo = MENSALIDADE, valorOriginal = valor, desconto = 0.
ALTER TABLE "mensalidades" ADD COLUMN     "desconto" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "tipo" "TipoCobranca" NOT NULL DEFAULT 'MENSALIDADE',
ADD COLUMN     "valor_original" DECIMAL(10,2);

UPDATE "mensalidades" SET "valor_original" = "valor";

ALTER TABLE "mensalidades" ALTER COLUMN "valor_original" SET NOT NULL;

-- Único por aluno + mês + tipo (antes: aluno + mês).
DROP INDEX "mensalidades_aluno_id_mes_referencia_key";
CREATE UNIQUE INDEX "mensalidades_aluno_id_mes_referencia_tipo_key" ON "mensalidades"("aluno_id", "mes_referencia", "tipo");

-- Configuração (linha única).
CREATE TABLE "configuracoes" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "dia_vencimento_padrao" INTEGER NOT NULL DEFAULT 10,
    "meses_cobranca" INTEGER[] DEFAULT ARRAY[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]::INTEGER[],
    "cobranca_automatica" BOOLEAN NOT NULL DEFAULT false,
    "cobrar_matricula" BOOLEAN NOT NULL DEFAULT false,
    "valor_matricula" DECIMAL(10,2),
    "dias_vencimento_matricula" INTEGER NOT NULL DEFAULT 5,
    "periodo_matricula_ate" TEXT,
    "desconto_na_matricula" BOOLEAN NOT NULL DEFAULT false,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "configuracoes_pkey" PRIMARY KEY ("id")
);

-- Linha padrão com cobrança automática DESLIGADA: nada é gerado antes de a escola revisar a configuração.
INSERT INTO "configuracoes" ("id", "atualizado_em") VALUES (1, CURRENT_TIMESTAMP);
