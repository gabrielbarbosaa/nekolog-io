export type LabelDefinition = {
  colour: string
  description: string
}

export const LABELS: Record<string, LabelDefinition> = {
  a11y: { colour: '006b75', description: 'Acessibilidade' },
  chore: { colour: 'ededed', description: 'Manutenção e ferramentas' },
  ci: { colour: '1d76db', description: 'Integração contínua' },
  docs: { colour: '0075ca', description: 'Documentação' },
  feat: { colour: '0e8a16', description: 'Funcionalidade nova' },
  fix: { colour: 'd73a4a', description: 'Correção de defeito' },
  infra: { colour: '5319e7', description: 'Infraestrutura como código' },
  security: { colour: 'd93f0b', description: 'Segurança' },
  test: { colour: 'bfd4f2', description: 'Testes' },
}

export const FALLBACK_LABEL: LabelDefinition = {
  colour: 'ededed',
  description: 'Etapa do roadmap',
}

export function labelFor(prefix: string): LabelDefinition {
  return LABELS[prefix] ?? FALLBACK_LABEL
}
