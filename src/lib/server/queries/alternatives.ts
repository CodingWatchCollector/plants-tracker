import type { Client } from '@libsql/client';
import type { HomeProfile, PlantSpecies } from '$lib/types';
import { rowToSpecies } from './catalog';

export interface Alternative {
  species: PlantSpecies;
  similarity: number; // 0-8, see SIMILARITY_WEIGHTS
  explanation: string;
}

type AlternativesHome = Pick<
  HomeProfile,
  'has_cats' | 'has_dogs' | 'care_commitment' | 'typical_light' | 'travels_often'
>;

type GetAlternativesProps = {
  db: Client;
  homeProfile: AlternativesHome;
  candidate: PlantSpecies;
  // Species the home already owns; suggesting them again would be pointless.
  excludeSpeciesIds?: number[];
  limit?: number;
};

export const SIMILARITY_WEIGHTS = {
  growth_habit: 3,
  leaf_size: 2,
  leaf_shape: 2,
  variegated: 1,
} as const;

const CARE_LEVELS = ['low', 'medium', 'high'] as const;
const LIGHT_LEVELS = ['low', 'medium', 'bright'] as const;

// Levels up to and including `max`: a plant may need less than the home offers, never more.
const upTo = <T extends string>(levels: readonly T[], max: T) =>
  levels.slice(0, levels.indexOf(max) + 1);

const placeholders = (values: unknown[]) => values.map(() => '?').join(', ');

// Plants that look like the candidate and suit the home. The hard filters below are in SQL,
// so an unsafe or unsuitable plant can never come back, whatever the similarity score says:
//   - not the candidate itself, not already owned
//   - not toxic to a pet the home has
//   - care_level no higher than the household's care_commitment
//   - light_needs no higher than the home's typical_light
//   - drought_tolerance not 'low' when the home travels often
// Highest similarity first; ties are broken by common name so the order is stable.
export const getAlternatives = async ({
  db,
  homeProfile,
  candidate,
  excludeSpeciesIds = [],
  limit = 3,
}: GetAlternativesProps): Promise<Alternative[]> => {
  const excluded = [candidate.id, ...excludeSpeciesIds];
  const careLevels = upTo(CARE_LEVELS, homeProfile.care_commitment);
  const lightLevels = upTo(LIGHT_LEVELS, homeProfile.typical_light);
  const droughtLevels = homeProfile.travels_often ? ['medium', 'high'] : ['low', 'medium', 'high'];

  const where = [
    `ps.id NOT IN (${placeholders(excluded)})`,
    `ps.care_level IN (${placeholders(careLevels)})`,
    `ps.light_needs IN (${placeholders(lightLevels)})`,
    `ps.drought_tolerance IN (${placeholders(droughtLevels)})`,
  ];
  if (homeProfile.has_cats) where.push('ps.toxic_to_cats = 0');
  if (homeProfile.has_dogs) where.push('ps.toxic_to_dogs = 0');

  const { rows } = await db.execute({
    sql: `SELECT ps.*,
            (ps.growth_habit = ?) * ${SIMILARITY_WEIGHTS.growth_habit}
            + (ps.leaf_size = ?) * ${SIMILARITY_WEIGHTS.leaf_size}
            + (LOWER(ps.leaf_shape) = LOWER(?)) * ${SIMILARITY_WEIGHTS.leaf_shape}
            + (ps.variegated = ?) * ${SIMILARITY_WEIGHTS.variegated} AS similarity
          FROM plant_species ps
          WHERE ${where.join(' AND ')}
          ORDER BY similarity DESC, ps.common_name ASC
          LIMIT ?`,
    args: [
      candidate.growth_habit,
      candidate.leaf_size,
      candidate.leaf_shape,
      candidate.variegated ? 1 : 0,
      ...excluded,
      ...careLevels,
      ...lightLevels,
      ...droughtLevels,
      limit,
    ],
  });

  return rows.map((row) => {
    const species = rowToSpecies(row);
    return {
      species,
      similarity: Number(row.similarity),
      explanation: explainAlternative(species, candidate, homeProfile),
    };
  });
};

// Templated, no model involved: what it has in common with the candidate, and why it suits the home.
export const explainAlternative = (
  species: PlantSpecies,
  candidate: PlantSpecies,
  homeProfile: AlternativesHome
): string => {
  const alike: string[] = [];
  if (species.growth_habit === candidate.growth_habit) alike.push(`${species.growth_habit} habit`);
  if (species.leaf_size === candidate.leaf_size) alike.push(`${species.leaf_size} leaves`);
  if (species.leaf_shape.toLowerCase() === candidate.leaf_shape.toLowerCase()) {
    alike.push(`${species.leaf_shape} leaf shape`);
  }
  if (species.variegated && candidate.variegated) alike.push('variegated leaves');

  const look = alike.length
    ? `Similar look to ${candidate.common_name}: ${alike.join(', ')}.`
    : `Looks different from ${candidate.common_name}, but suits your home.`;

  const pets = [homeProfile.has_cats && 'cats', homeProfile.has_dogs && 'dogs'].filter(Boolean);
  const safety = pets.length ? ` Non-toxic to ${pets.join(' and ')}.` : '';

  return `${look}${safety} ${capitalize(species.care_level)} care.`;
};

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
