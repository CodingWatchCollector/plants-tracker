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

export type PlantFormData = Omit<Plant, 'id' | 'home_id' | 'created_at' | 'updated_at'>;
