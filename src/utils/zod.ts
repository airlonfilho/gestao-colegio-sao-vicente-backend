import { z } from "zod";

/**
 * Helpers para campos opcionais vindos do frontend.
 *
 * Na edição, o frontend envia `null` para limpar um campo opcional e às vezes `""` quando o
 * campo fica em branco. Sem estes helpers, `null` dava 400 e, em datas, `z.coerce.date()`
 * transformava `null` em 01/01/1970 silenciosamente.
 */

const vazioParaUndefined = (v: unknown) => (v === "" ? undefined : v);

/** Texto opcional: aceita string, `null` (limpa o campo) ou ausente. `""` vira `null`. */
export const textoOpcional = z.preprocess((v) => (v === "" ? null : v), z.string().nullable().optional());

/** E-mail opcional: aceita e-mail válido, `null` (limpa) ou ausente. `""` vira `null`. */
export const emailOpcional = z.preprocess((v) => (v === "" ? null : v), z.string().email().nullable().optional());

/** Data opcional: aceita data/ISO, `null` (limpa) ou ausente. `""` é tratado como ausente. */
export const dataOpcional = z.preprocess(vazioParaUndefined, z.union([z.null(), z.coerce.date()]).optional());

/** Data opcional que não pode ser limpa (ex.: data de pagamento): `""` e `null` contam como ausente. */
export const dataOpcionalSemNull = z.preprocess(
  (v) => (v === "" || v === null ? undefined : v),
  z.coerce.date().optional()
);

/** Tamanho máximo do data URL (~3 MB de imagem viram ~4 MB em base64). */
const TAMANHO_MAXIMO_FOTO = 4_300_000;

/** Foto em data URL base64 (JPG, PNG ou WebP), `null` para remover, ou ausente. */
export const fotoOpcional = z
  .string()
  .max(TAMANHO_MAXIMO_FOTO, { message: "Imagem muito grande (máximo de 3 MB)." })
  .regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/, {
    message: "Envie uma imagem JPG, PNG ou WebP.",
  })
  .nullable()
  .optional();
