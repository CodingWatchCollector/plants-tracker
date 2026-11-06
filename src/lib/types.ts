export interface Home {
  id: number;
  name: string;
  access_token: string;
  join_token: string;
  created_at: string;
}

export interface Plant {
  id: number;
  home_id: number;
  name: string;
  nickname: string | null;
  room: string | null;
  image_url: string | null;
  watering_interval_days: number;
  last_watered_at: string | null;
  next_watering_date: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface PushSubscription {
  id: number;
  home_id: number;
  endpoint: string;
  p256dh_key: string;
  auth_key: string;
  created_at: string;
}

export interface HomeProfile {
  home_id: number;
  has_cats: boolean;
  has_dogs: boolean;
  has_small_kids: boolean;
  care_commitment: 'low' | 'medium' | 'high';
  typical_light: 'low' | 'medium' | 'bright';
  travels_often: boolean;
  notes: string;
  updated_at: string | null;
}

export interface PlantSpecies {
  id: number;
  scientific_name: string;
  common_name: string;
  aliases: string[];
  watering_interval_days: number;
  drought_tolerance: 'low' | 'medium' | 'high';
  care_level: 'low' | 'medium' | 'high';
  light_needs: 'low' | 'medium' | 'bright';
  toxic_to_cats: boolean;
  toxic_to_dogs: boolean;
  toxicity_notes: string | null;
  growth_habit: 'trailing' | 'upright' | 'tree' | 'rosette' | 'climbing';
  leaf_size: 'small' | 'medium' | 'large';
  leaf_shape: string;
  variegated: boolean;
  care_tips: string | null;
  source: string;
  source_url: string | null;
  reviewed_at: string;
}

// A plant the household owns, with its catalog row when the name matched one.
export interface OwnedPlant {
  name: string;
  species: PlantSpecies | null;
}

export type PlantFormData = Omit<Plant, 'id' | 'home_id' | 'created_at' | 'updated_at'>;
