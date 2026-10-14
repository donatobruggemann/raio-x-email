/** Resultado da auditoria de entregabilidade de um domínio. */
export interface AuditoriaResultado {
  domain: string;
  mx: string;
  mx_provider: string;
  esp: string;
  spf: string;
  spf_policy: "" | "+all" | "-all" | "~all" | "?" | "sem all";
  spf_lookups: number;
  dmarc: string;
  dmarc_policy: "" | "none" | "quarantine" | "reject" | "?";
  dmarc_pct: string;
  dmarc_rua: boolean;
  dkim_selectors: string;
  bimi: boolean;
  mta_sts: boolean;
  score: number;
  findings: string[];
  severity: "ok" | "alta" | "média" | "baixa" | "indeterminado" | "erro";
  dns_indeterminado: boolean;
  dns_falhas: string[];
  /**
   * O domínio não existe no DNS (NXDOMAIN): vencido, digitado errado ou nunca registrado.
   *
   * É diferente de "existe mas está mal configurado". Um domínio que não existe não tem
   * como ser protegido nem como ser usado para falsificar email — provedor costuma recusar
   * remetente de domínio inexistente. Acusar falta de proteção aqui seria afirmar o que
   * não se mediu, então nada é acusado.
   */
  dominio_inexistente: boolean;
}

/** Configuração de timeout e retry para consultas DNS. */
export interface ConfigDNS {
  timeoutMs?: number;
  maxTentativas?: number;
  intervaloEsperaMs?: number;
}
