/**
 * LGPD — exposição mínima de dados dos responsáveis.
 *
 * Admin vê o cadastro completo. Professor vê só id e nome: CPF, telefone,
 * e-mail e endereço não são necessários para o trabalho dele.
 */
type Perfil = "admin" | "professor";

/** Para usar em `include: { responsavel: incluirResponsavel(perfil) }`. */
export function incluirResponsavel(perfil: Perfil) {
  return perfil === "admin" ? true : { select: { id: true, nome: true } };
}

/** Campos de um responsável (consulta direta em /responsaveis) conforme o perfil. */
export function camposResponsavel(perfil: Perfil) {
  const alunos = { select: { id: true, nome: true } };
  return perfil === "admin"
    ? { id: true, nome: true, cpf: true, telefone: true, email: true, endereco: true, alunos }
    : { id: true, nome: true, alunos };
}

const CAMPOS_DESCONTO = ["tipoDesconto", "valorDesconto", "motivoDesconto", "descontoAte"] as const;

/** Remove os campos de desconto/bolsa do aluno para quem não é admin. */
export function ocultarDesconto<T extends object>(perfil: Perfil, aluno: T): T {
  if (perfil === "admin") return aluno;
  const copia = { ...aluno } as Record<string, unknown>;
  for (const campo of CAMPOS_DESCONTO) delete copia[campo];
  delete copia.valorMensalidadePersonalizado;
  return copia as T;
}
