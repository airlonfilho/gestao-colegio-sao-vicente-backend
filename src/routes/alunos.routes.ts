import { FastifyInstance } from "fastify";
import { z } from "zod";
import { lerPaginacao, paginar } from "../utils/paginacao.js";
import { dataOpcional, fotoOpcional } from "../utils/zod.js";
import { incluirResponsavel } from "../utils/privacidade.js";
import { comDisciplinaIds, includeCurriculo } from "./turmas.routes.js";

export const schema = z.object({
  nome: z.string().min(1),
  dataNascimento: dataOpcional,
  foto: fotoOpcional,
  turmaId: z.number().int(),
  responsavelId: z.number().int(),
  status: z.enum(["ATIVO", "INATIVO"]).optional(),
});

export const observacaoSchema = z.object({
  anoLetivo: z.number().int(),
  /** "anual" ou o semestre ("1" / "2"), como na tela do boletim. */
  periodo: z.enum(["anual", "1", "2"]),
  texto: z.string().trim().max(1800, { message: "Limite de 1.800 caracteres." }),
});

export default async function alunosRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get("/", async (request) => {
    const query = request.query as { busca?: string; status?: string; pagina?: string; tamanhoPagina?: string };

    const where = {
      ...(query.busca ? { nome: { contains: query.busca, mode: "insensitive" as const } } : {}),
      ...(query.status === "TODOS" ? {} : { status: (query.status as "ATIVO" | "INATIVO") ?? "ATIVO" }),
    };

    const argsComuns = { where, include: { turma: true, responsavel: incluirResponsavel(request.user.perfil) }, orderBy: { nome: "asc" as const } };

    const paginacao = lerPaginacao(query);
    if (!paginacao) {
      return app.prisma.aluno.findMany(argsComuns);
    }

    const [dados, total] = await Promise.all([
      app.prisma.aluno.findMany({ ...argsComuns, skip: paginacao.skip, take: paginacao.take }),
      app.prisma.aluno.count({ where }),
    ]);
    return paginar(dados, total, paginacao);
  });

  app.get("/:id", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const aluno = await app.prisma.aluno.findUnique({
      where: { id },
      include: { turma: true, responsavel: incluirResponsavel(request.user.perfil) },
    });
    if (!aluno) return reply.code(404).send({ message: "Aluno não encontrado" });
    return aluno;
  });

  app.get("/:id/boletim", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const encontrado = await app.prisma.aluno.findUnique({
      where: { id },
      include: { turma: { include: includeCurriculo } },
    });
    if (!encontrado) return reply.code(404).send({ message: "Aluno não encontrado" });
    const aluno = { ...encontrado, turma: comDisciplinaIds(encontrado.turma) };

    const [notas, observacoes] = await Promise.all([
      app.prisma.nota.findMany({
        where: { alunoId: id },
        include: { disciplina: true },
        orderBy: [{ disciplina: { nome: "asc" } }, { bimestre: "asc" }],
      }),
      app.prisma.observacaoBoletim.findMany({
        where: { alunoId: id },
        select: { anoLetivo: true, periodo: true, texto: true },
        orderBy: [{ anoLetivo: "desc" }, { periodo: "asc" }],
      }),
    ]);

    return { aluno, notas, observacoes };
  });

  /** Salva (cria ou substitui) a observação do boletim para um ano letivo + período. */
  app.patch("/:id/boletim", { preHandler: app.authorize(["admin"]) }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const body = observacaoSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send(body.error.flatten());

    const aluno = await app.prisma.aluno.findUnique({ where: { id }, select: { id: true } });
    if (!aluno) return reply.code(404).send({ message: "Aluno não encontrado" });

    const { anoLetivo, periodo, texto } = body.data;
    return app.prisma.observacaoBoletim.upsert({
      where: { alunoId_anoLetivo_periodo: { alunoId: id, anoLetivo, periodo } },
      create: { alunoId: id, anoLetivo, periodo, texto },
      update: { texto },
      select: { anoLetivo: true, periodo: true, texto: true },
    });
  });

  app.post("/", { preHandler: app.authorize(["admin"]) }, async (request, reply) => {
    const body = schema.safeParse(request.body);
    if (!body.success) return reply.code(400).send(body.error.flatten());
    const aluno = await app.prisma.aluno.create({ data: body.data });
    return reply.code(201).send(aluno);
  });

  app.patch("/:id", { preHandler: app.authorize(["admin"]) }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const body = schema.partial().safeParse(request.body);
    if (!body.success) return reply.code(400).send(body.error.flatten());
    return app.prisma.aluno.update({ where: { id }, data: body.data });
  });

  app.delete("/:id", { preHandler: app.authorize(["admin"]) }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    await app.prisma.aluno.update({ where: { id }, data: { status: "INATIVO" } });
    return reply.code(204).send();
  });
}
