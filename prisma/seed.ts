import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { normalizarNome } from "../src/utils/texto.js";

const prisma = new PrismaClient();

async function main() {
  const senhaHash = await bcrypt.hash("admin123", 10);

  const admin = await prisma.usuario.upsert({
    where: { email: "admin@escola.com" },
    update: {},
    create: { nome: "Administrador", email: "admin@escola.com", senhaHash, perfil: "admin" },
  });

  const professor = await prisma.usuario.upsert({
    where: { email: "professor@escola.com" },
    update: {},
    create: {
      nome: "João Silva",
      email: "professor@escola.com",
      senhaHash: await bcrypt.hash("professor123", 10),
      perfil: "professor",
    },
  });

  const turma = await prisma.turma.create({
    data: { nome: "9º Ano A", nivelEnsino: "Fundamental II", sala: "301", anoLetivo: 2026, valorMensalidade: 1850 },
  });

  const matematica = await prisma.disciplina.upsert({
    where: { nomeNormalizado: normalizarNome("Matemática") },
    update: {},
    create: { nome: "Matemática", nomeNormalizado: normalizarNome("Matemática") },
  });

  await prisma.turmaDisciplinaProfessor.create({
    data: { turmaId: turma.id, disciplinaId: matematica.id, usuarioId: professor.id },
  });

  const responsavel = await prisma.responsavel.create({
    data: { nome: "Maria Silva", cpf: "12345678900", telefone: "11987654321", email: "maria.silva@email.com" },
  });

  const aluno = await prisma.aluno.create({
    data: { nome: "Ana Clara Silva", turmaId: turma.id, responsavelId: responsavel.id },
  });

  await prisma.mensalidade.create({
    data: {
      alunoId: aluno.id,
      mesReferencia: "2026-02",
      valor: 1850,
      vencimento: new Date("2026-02-05"),
      status: "PENDENTE",
    },
  });

  const funcionario = await prisma.funcionario.create({
    data: { nome: "Carlos Oliveira", cargo: "Financeiro", cpf: "98765432100" },
  });

  await prisma.despesa.create({
    data: {
      titulo: "Conta de Energia Elétrica",
      categoria: "Utilidades",
      funcionarioId: funcionario.id,
      formaPagamento: "DINHEIRO",
      valor: 4200,
      data: new Date("2026-02-08"),
    },
  });

  console.log({ admin: admin.email, professor: professor.email, turma: turma.nome, aluno: aluno.nome });
}

main()
  .catch((erro) => {
    console.error(erro);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
