/**
 * Integração com a Evolution API (container `evolution` no docker-compose), que mantém a sessão do WhatsApp.
 *
 * A escola usa uma única instância (um número de WhatsApp). O backend é a única ponte até a Evolution:
 * a chave da API nunca vai para o navegador.
 *
 * Variáveis: EVOLUTION_API_URL, EVOLUTION_API_KEY e EVOLUTION_INSTANCE (opcional).
 */

export type EstadoWhatsapp = "conectado" | "conectando" | "desconectado";

export class ErroWhatsapp extends Error {
  constructor(mensagem: string, readonly status = 502) {
    super(mensagem);
  }
}

const urlBase = () => (process.env.EVOLUTION_API_URL ?? "").replace(/\/$/, "");
const chave = () => process.env.EVOLUTION_API_KEY ?? "";
const instancia = () => encodeURIComponent(process.env.EVOLUTION_INSTANCE || "colegio-sao-vicente");

export const whatsappConfigurado = () => Boolean(urlBase() && chave());

/** Telefone brasileiro só com dígitos e DDI: (88) 99999-0000 → 5588999990000. */
export function numeroWhatsapp(telefone: string) {
  const digitos = telefone.replace(/\D/g, "");
  return digitos.length === 10 || digitos.length === 11 ? "55" + digitos : digitos;
}

/** Mensagem de erro legível a partir das respostas da Evolution ({ response: { message: [...] } } ou { message }). */
function mensagemDe(corpo: unknown) {
  const c = corpo as { message?: unknown; response?: { message?: unknown } } | null;
  const bruta = c?.response?.message ?? c?.message;
  const texto = Array.isArray(bruta) ? bruta.flat().filter((m) => typeof m === "string").join(" ") : typeof bruta === "string" ? bruta : "";
  return texto || "O serviço de WhatsApp recusou a operação.";
}

async function chamar(caminho: string, metodo: "GET" | "POST" | "DELETE" = "GET", corpo?: unknown) {
  if (!whatsappConfigurado()) {
    throw new ErroWhatsapp("O WhatsApp não está configurado no servidor (EVOLUTION_API_URL e EVOLUTION_API_KEY).", 503);
  }
  let resposta: Response;
  try {
    resposta = await fetch(urlBase() + caminho, {
      method: metodo,
      headers: { apikey: chave(), ...(corpo ? { "content-type": "application/json" } : {}) },
      body: corpo ? JSON.stringify(corpo) : undefined,
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new ErroWhatsapp("O serviço de WhatsApp está fora do ar. Verifique o container da Evolution API.");
  }
  if (resposta.status === 401) throw new ErroWhatsapp("A chave da Evolution API está incorreta (EVOLUTION_API_KEY).");
  return { status: resposta.status, corpo: (await resposta.json().catch(() => null)) as Record<string, any> | null };
}

async function estadoAtual(): Promise<{ existe: boolean; estado: EstadoWhatsapp }> {
  const { status, corpo } = await chamar(`/instance/connectionState/${instancia()}`);
  if (status === 404) return { existe: false, estado: "desconectado" };
  if (status >= 400) throw new ErroWhatsapp(mensagemDe(corpo));
  const state = corpo?.instance?.state;
  return { existe: true, estado: state === "open" ? "conectado" : state === "connecting" ? "conectando" : "desconectado" };
}

export async function statusWhatsapp() {
  const { estado } = await estadoAtual();
  if (estado !== "conectado") return { estado };
  // Dados do número conectado (melhor esforço: se falhar, o status continua valendo).
  const { corpo } = await chamar(`/instance/fetchInstances?instanceName=${instancia()}`).catch(() => ({ corpo: null }));
  const dados = (Array.isArray(corpo) ? corpo[0] : null) as Record<string, any> | null;
  const jid = String(dados?.ownerJid ?? dados?.instance?.owner ?? "");
  return {
    estado,
    numero: jid.split("@")[0].replace(/\D/g, "") || undefined,
    nome: dados?.profileName ?? dados?.instance?.profileName ?? undefined,
    foto: dados?.profilePicUrl ?? dados?.instance?.profilePictureUrl ?? undefined,
  };
}

/**
 * Inicia a conexão: cria a instância na primeira vez e devolve o QR Code (ou o código de pareamento,
 * quando `numero` é informado, para conectar sem câmera).
 */
export async function conectarWhatsapp(numero?: string) {
  const atual = await estadoAtual();
  if (atual.estado === "conectado") return { estado: "conectado" as const };
  if (!atual.existe) {
    const criada = await chamar("/instance/create", "POST", { instanceName: decodeURIComponent(instancia()), integration: "WHATSAPP-BAILEYS", qrcode: true });
    // 403 = nome já em uso (outra requisição criou antes): segue normalmente.
    if (criada.status >= 400 && criada.status !== 403) throw new ErroWhatsapp(mensagemDe(criada.corpo));
  }
  const { status, corpo } = await chamar(`/instance/connect/${instancia()}${numero ? "?number=" + numeroWhatsapp(numero) : ""}`);
  if (status >= 400) throw new ErroWhatsapp(mensagemDe(corpo));
  if (corpo?.instance?.state === "open") return { estado: "conectado" as const };
  const base64 = typeof corpo?.base64 === "string" ? corpo.base64 : "";
  return {
    estado: "conectando" as const,
    qrcode: base64 ? (base64.startsWith("data:") ? base64 : "data:image/png;base64," + base64) : undefined,
    codigoPareamento: typeof corpo?.pairingCode === "string" ? corpo.pairingCode : undefined,
  };
}

/** Desconecta o número (logout). A instância continua existindo para conectar de novo depois. */
export async function desconectarWhatsapp() {
  const { status, corpo } = await chamar(`/instance/logout/${instancia()}`, "DELETE");
  // 404 = instância nem existe; 400 = já estava desconectada. Nos dois casos o resultado é o mesmo.
  if (status >= 400 && status !== 404 && status !== 400) throw new ErroWhatsapp(mensagemDe(corpo));
}

export async function enviarTexto(telefone: string, texto: string) {
  const { status, corpo } = await chamar(`/message/sendText/${instancia()}`, "POST", { number: numeroWhatsapp(telefone), text: texto });
  if (status >= 400) {
    const { estado } = await estadoAtual().catch(() => ({ estado: "desconectado" as EstadoWhatsapp }));
    throw new ErroWhatsapp(estado === "conectado" ? mensagemDe(corpo) : "O WhatsApp da escola está desconectado. Conecte na tela do WhatsApp.");
  }
  return corpo;
}
