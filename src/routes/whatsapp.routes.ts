import { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { telefoneValido } from "../utils/validadores.js";
import {
  conectarWhatsapp,
  desconectarWhatsapp,
  enviarTexto,
  ErroWhatsapp,
  statusWhatsapp,
  whatsappConfigurado,
} from "../services/whatsapp.js";

export const conectarSchema = z.object({
  /** Opcional: com o número, a Evolution devolve um código de pareamento (conectar sem ler QR Code). */
  numero: z.string().refine(telefoneValido, { message: "Telefone inválido (use DDD + número)" }).optional(),
});

export const testeSchema = z.object({
  telefone: z.string().refine(telefoneValido, { message: "Telefone inválido (use DDD + número)" }),
  mensagem: z.string().trim().min(1).max(1000).optional(),
});

/** Conexão do número de WhatsApp da escola (Evolution API). Só admin. */
export default async function whatsappRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authorize(["admin"]));

  const falha = (reply: FastifyReply, erro: unknown) => {
    if (erro instanceof ErroWhatsapp) return reply.code(erro.status).send({ message: erro.message });
    throw erro;
  };

  // Sempre 200: a tela mostra "não configurado" / "indisponível" em vez de um erro genérico.
  app.get("/status", async () => {
    if (!whatsappConfigurado()) return { configurado: false, estado: "desconectado" };
    try {
      return { configurado: true, ...(await statusWhatsapp()) };
    } catch (erro) {
      if (erro instanceof ErroWhatsapp) return { configurado: true, estado: "indisponivel", erro: erro.message };
      throw erro;
    }
  });

  app.post("/conectar", async (request, reply) => {
    const body = conectarSchema.safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send(body.error.flatten());
    try {
      return await conectarWhatsapp(body.data.numero);
    } catch (erro) {
      return falha(reply, erro);
    }
  });

  app.post("/desconectar", async (_request, reply) => {
    try {
      await desconectarWhatsapp();
      return reply.code(204).send();
    } catch (erro) {
      return falha(reply, erro);
    }
  });

  app.post("/teste", async (request, reply) => {
    const body = testeSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send(body.error.flatten());
    try {
      await enviarTexto(body.data.telefone, body.data.mensagem ?? "Mensagem de teste do sistema do Colégio São Vicente. A conexão do WhatsApp está funcionando.");
      return { enviado: true };
    } catch (erro) {
      return falha(reply, erro);
    }
  });
}
