-- CreateIndex
CREATE INDEX "alunos_turma_id_idx" ON "alunos"("turma_id");

-- CreateIndex
CREATE INDEX "alunos_responsavel_id_idx" ON "alunos"("responsavel_id");

-- CreateIndex
CREATE INDEX "alunos_nome_idx" ON "alunos"("nome");

-- CreateIndex
CREATE INDEX "alunos_status_idx" ON "alunos"("status");

-- CreateIndex
CREATE INDEX "despesas_funcionario_id_idx" ON "despesas"("funcionario_id");

-- CreateIndex
CREATE INDEX "mensagens_whatsapp_aluno_id_idx" ON "mensagens_whatsapp"("aluno_id");

-- CreateIndex
CREATE INDEX "mensalidades_status_vencimento_idx" ON "mensalidades"("status", "vencimento");

-- CreateIndex
CREATE INDEX "mensalidades_mes_referencia_idx" ON "mensalidades"("mes_referencia");

-- CreateIndex
CREATE INDEX "notas_disciplina_id_idx" ON "notas"("disciplina_id");

-- CreateIndex
CREATE INDEX "notas_lancado_por_idx" ON "notas"("lancado_por");

-- CreateIndex
CREATE INDEX "registros_funcionario_funcionario_id_idx" ON "registros_funcionario"("funcionario_id");

-- CreateIndex
CREATE INDEX "turma_disciplina_professor_usuario_id_idx" ON "turma_disciplina_professor"("usuario_id");
