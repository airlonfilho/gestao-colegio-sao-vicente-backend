import { PrismaClient } from "@prisma/client";

/** Apaga tudo, respeitando a ordem de dependência das FKs. */
export async function limparBanco(prisma: PrismaClient) {
  await prisma.mensagemWhatsapp.deleteMany();
  await prisma.nota.deleteMany();
  await prisma.mensalidade.deleteMany();
  await prisma.turmaDisciplinaProfessor.deleteMany();
  await prisma.turmaDisciplina.deleteMany();
  await prisma.aluno.deleteMany();
  await prisma.despesa.deleteMany();
  await prisma.registroFuncionario.deleteMany();
  await prisma.responsavel.deleteMany();
  await prisma.turma.deleteMany();
  await prisma.disciplina.deleteMany();
  await prisma.funcionario.deleteMany();
  await prisma.usuario.deleteMany();
  // Configuração volta aos padrões (é recriada por obterConfiguracao).
  await prisma.configuracao.deleteMany();
}
