import type { NicheSlug } from '@/dtos/smartIntelligence'

export interface NichePreset {
  slug: NicheSlug
  name: string
  description: string
  instructions: string
  keywords: string[]
  negativeKeywords: string[]
}

export const NICHE_PRESETS: readonly NichePreset[] = [
  {
    slug: 'domestica',
    name: 'DOMESTICA',
    description:
      'Mulheres interessadas em casa, rotina, beleza, autocuidado e acessórios femininos úteis.',
    instructions:
      'Inclua cozinha, eletroportáteis, limpeza, organização, decoração residencial, cama/mesa/banho, beleza, skincare, cabelo, higiene pessoal, bolsas e acessórios femininos. Produtos unissex entram somente com vínculo direto a essa rotina. Equilibre casa e autocuidado. Utilidade geral ou uso dentro de casa não bastam: telefone comum, item especializado de pet, aquário ou pesca não é DOMESTICA sem outro vínculo explícito. Exclua peças automotivas, pesca, itens industriais, armas, medicamentos e produtos sem uso claro para essa audiência.',
    keywords: [
      'organizador',
      'panela',
      'hermético',
      'herméticos',
      'aspirador',
      'edredom',
      'secadora',
      'skincare',
      'modelador',
      'necessaire',
      'maquiagem',
      'airfryer',
    ],
    negativeKeywords: ['peça automotiva', 'isca de pesca', 'equipamento industrial', 'medicamento'],
  },
  {
    slug: 'masculino',
    name: 'MASCULINO',
    description:
      'Homens interessados em tecnologia, cuidados pessoais, ferramentas, fitness, moda e carro.',
    instructions:
      'Inclua eletrônicos e tecnologia de uso cotidiano, barbearia e grooming, ferramentas, academia e esportes, moda e acessórios masculinos e acessórios automotivos universais. Produtos unissex podem entrar com caso de uso masculino claro. Exclua itens puramente decorativos sem apelo ao nicho, produtos exclusivamente femininos, pesca genérica sem equipamento específico e peças automotivas cuja compatibilidade não esteja indicada.',
    keywords: [
      'barbeador',
      'aparador',
      'parafusadeira',
      'furadeira',
      'multímetro',
      'catraca',
      'masculino',
      'automotivo',
      'halter',
      'smartwatch',
      'carteira',
      'bluetooth',
    ],
    negativeKeywords: [
      'maquiagem',
      'bolsa feminina',
      'vestido feminino',
      'peça sem compatibilidade',
    ],
  },
  {
    slug: 'natal',
    name: 'NATAL',
    description: 'Decoração natalina, celebração, embalagem e presentes com intenção clara.',
    instructions:
      'Inclua árvores, luzes, guirlandas, enfeites, mesa posta, embalagem, lembranças e kits explicitamente presenteáveis. Fora da decoração, só aceite produto com intenção de presente declarada e destinatário ou faixa de orçamento clara. Um produto comum não vira natalino por ser possível presente, mesmo perto de dezembro; mantenha-o abaixo de 40 sem evidência temática. Diminua fortemente a relevância após 25 de dezembro. Nunca presuma entrega antes do Natal. Exclua decoração de outras festas, produtos adultos, armas e medicamentos.',
    keywords: [
      'natalino',
      'natalina',
      'guirlanda',
      'pisca-pisca',
      'presépio',
      'panetone',
      'papai noel',
      'árvore natal',
      'festão',
      'enfeite natal',
      'embalagem',
      'amigo secreto',
    ],
    negativeKeywords: [
      'fantasia halloween',
      'decoração aniversário',
      'medicamento',
      'produto adulto',
    ],
  },
  {
    slug: 'pesca',
    name: 'PESCA',
    description: 'Pescadores esportivos e recreativos, com equipamentos e acessórios específicos.',
    instructions:
      'Inclua varas, molinetes, carretilhas, linhas, anzóis, iscas artificiais, alicates, caixas de pesca, suportes e vestuário técnico diretamente útil à pesca. Valorize especificações de modalidade, espécie e compatibilidade quando fornecidas. Exclua camping, náutica e outdoor genéricos sem uso direto em pesca, aquários, brinquedos em formato de peixe, armas e alegações sobre períodos legais regionais.',
    keywords: [
      'molinete',
      'molinetes',
      'carretilha',
      'carretilhas',
      'anzol',
      'anzóis',
      'isca',
      'iscas',
      'multifilamento',
      'chumbada',
      'passaguá',
      'pesca',
    ],
    negativeKeywords: ['aquário', 'brinquedo peixe', 'decoração peixe', 'camping genérico'],
  },
  {
    slug: 'pet',
    name: 'PET',
    description: 'Tutores de cães, gatos e outros animais domésticos, com foco em cuidado diário.',
    instructions:
      'Inclua alimentação e hidratação, brinquedos, camas, higiene, passeio, transporte, segurança, arranhadores e acessórios domésticos para cães e gatos. Considere espécie, porte e idade quando informados. Exclua medicamentos veterinários, pesticidas, produtos para animais de produção, caça, fauna silvestre e itens sem compatibilidade clara. Medicamentos nunca devem ser aprovados automaticamente.',
    keywords: [
      'arranhador',
      'arranhadores',
      'comedouro',
      'bebedouro',
      'ração',
      'coleira',
      'peitoral',
      'tapete higiênico',
      'areia para gato',
      'cata-caca',
      'brinquedo pet',
      'transporte pet',
    ],
    negativeKeywords: ['medicamento veterinário', 'veneno', 'gado', 'caça', 'animal silvestre'],
  },
] as const

export const NICHE_PRESET_BY_SLUG = new Map(NICHE_PRESETS.map((preset) => [preset.slug, preset]))
