import { computePreview, type RecipePaper } from '../lib/spec-math'

type Fixture = {
  name: string
  mandrel_od_mm: number
  tube_length_mm: number
  target_dry_g: number
  adhesive_percent?: number
  parchment_percent?: number
  moisture_loss_percent?: number
  parchment_allowed?: boolean
  papers: RecipePaper[]
}

const fixtures: Fixture[] = [
  {
    name: 'default_four_ply',
    mandrel_od_mm: 62,
    tube_length_mm: 150,
    target_dry_g: 250,
    papers: [
      { paper_id: 'a', code: '250-18BF', gsm: 250, bulk: 1.3, ply_count: 2 },
      { paper_id: 'b', code: '300-20BF', gsm: 300, bulk: 1.25, ply_count: 1 },
      { paper_id: 'c', code: '350-24BF', gsm: 350, bulk: 1.2, ply_count: 1 },
    ],
  },
  {
    name: 'decimal_gsm_long_tube',
    mandrel_od_mm: 48.5,
    tube_length_mm: 205,
    target_dry_g: 185.5,
    papers: [
      { paper_id: 'p221', code: '221', gsm: 220, bulk: 1.5, ply_count: 2 },
      { paper_id: 'p231', code: '231', gsm: 230.5, bulk: 1.48, ply_count: 1 },
      { paper_id: 'p301', code: '301', gsm: 300, bulk: 1.5, ply_count: 2 },
    ],
  },
  {
    name: 'parchment_off',
    mandrel_od_mm: 55,
    tube_length_mm: 180,
    target_dry_g: 210,
    parchment_allowed: false,
    papers: [
      { paper_id: 'p350', code: '350', gsm: 350, bulk: 1.55, ply_count: 1 },
      { paper_id: 'p351', code: '351', gsm: 350, bulk: 1.5, ply_count: 1 },
      { paper_id: 'p352', code: '352', gsm: 350, bulk: 1.45, ply_count: 2 },
    ],
  },
  {
    name: 'custom_globals',
    mandrel_od_mm: 70.25,
    tube_length_mm: 125,
    target_dry_g: 325,
    adhesive_percent: 18,
    parchment_percent: 2,
    moisture_loss_percent: 10,
    papers: [
      { paper_id: 'p250', code: '250', gsm: 250, bulk: 1.3, ply_count: 3 },
      { paper_id: 'p300', code: '300', gsm: 300, bulk: 1.25, ply_count: 2 },
      { paper_id: 'p355', code: '355', gsm: 350, bulk: 1.55, ply_count: 1 },
    ],
  },
  {
    name: 'max_valid_papers',
    mandrel_od_mm: 38,
    tube_length_mm: 95,
    target_dry_g: 120,
    papers: [
      { paper_id: 'p221', code: '221', gsm: 220, bulk: 1.5, ply_count: 1 },
      { paper_id: 'p231', code: '231', gsm: 230, bulk: 1.5, ply_count: 1 },
      { paper_id: 'p301', code: '301', gsm: 300, bulk: 1.5, ply_count: 1 },
      { paper_id: 'p351', code: '351', gsm: 350, bulk: 1.5, ply_count: 1 },
      { paper_id: 'p354', code: '354', gsm: 350, bulk: 1.4, ply_count: 1 },
    ],
  },
]

function compactPreview(fixture: Fixture) {
  const preview = computePreview(fixture)
  return {
    name: fixture.name,
    id_mm: preview.id_mm,
    od_mm: preview.od_mm,
    wall_mm: preview.wall_mm,
    paper_weight_per_mm_g: preview.paper_weight_per_mm_g,
    paper_required_g: preview.paper_required_g,
    per_ply_thickness_mm: preview.per_ply_thickness_mm,
    per_ply_avg_dia_mm: preview.per_ply_avg_dia_mm,
    per_ply_weight_per_mm_g: preview.per_ply_weight_per_mm_g,
    tube: preview.tube,
    bamboo: preview.bamboo,
    bamboo_plan: preview.bamboo_plan,
    validation: preview.validation,
  }
}

console.log(JSON.stringify(fixtures.map(compactPreview), null, 2))
