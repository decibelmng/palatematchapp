export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      bottles: {
        Row: {
          added_by: string | null
          ax_acidity: number
          ax_body: number
          ax_fruit_char: number
          ax_sweet: number
          ax_tannin: number
          country: string | null
          created_at: string
          critic_score: number | null
          excluded_from_recs: boolean
          fp_acid: number
          fp_body: number
          fp_dispute_count: number
          fp_fresh: number
          fp_fruit_dark: number
          fp_harmonized_at: string | null
          fp_oak: number
          fp_ripe: number
          fp_savory: number
          fp_tannin: number
          fp_vec: string | null
          grape: string | null
          id: string
          name: string
          price_band: string | null
          producer: string | null
          refingerprinted_at: string | null
          region: string | null
          source: string | null
          tasting_note: string | null
          type: string
          unverified: boolean
          vintage: number | null
        }
        Insert: {
          added_by?: string | null
          ax_acidity?: number
          ax_body?: number
          ax_fruit_char?: number
          ax_sweet?: number
          ax_tannin?: number
          country?: string | null
          created_at?: string
          critic_score?: number | null
          excluded_from_recs?: boolean
          fp_acid?: number
          fp_body?: number
          fp_dispute_count?: number
          fp_fresh?: number
          fp_fruit_dark?: number
          fp_harmonized_at?: string | null
          fp_oak?: number
          fp_ripe?: number
          fp_savory?: number
          fp_tannin?: number
          fp_vec?: string | null
          grape?: string | null
          id?: string
          name: string
          price_band?: string | null
          producer?: string | null
          refingerprinted_at?: string | null
          region?: string | null
          source?: string | null
          tasting_note?: string | null
          type?: string
          unverified?: boolean
          vintage?: number | null
        }
        Update: {
          added_by?: string | null
          ax_acidity?: number
          ax_body?: number
          ax_fruit_char?: number
          ax_sweet?: number
          ax_tannin?: number
          country?: string | null
          created_at?: string
          critic_score?: number | null
          excluded_from_recs?: boolean
          fp_acid?: number
          fp_body?: number
          fp_dispute_count?: number
          fp_fresh?: number
          fp_fruit_dark?: number
          fp_harmonized_at?: string | null
          fp_oak?: number
          fp_ripe?: number
          fp_savory?: number
          fp_tannin?: number
          fp_vec?: string | null
          grape?: string | null
          id?: string
          name?: string
          price_band?: string | null
          producer?: string | null
          refingerprinted_at?: string | null
          region?: string | null
          source?: string | null
          tasting_note?: string | null
          type?: string
          unverified?: boolean
          vintage?: number | null
        }
        Relationships: []
      }
      canon_wines: {
        Row: {
          bottle_id: string
          created_at: string
          id: string
          rating_id: string
          region: string
          region_key: string | null
          replaced_at: string | null
          tier: string
          user_id: string
          wine_type: string
        }
        Insert: {
          bottle_id: string
          created_at?: string
          id?: string
          rating_id: string
          region: string
          region_key?: string | null
          replaced_at?: string | null
          tier: string
          user_id: string
          wine_type: string
        }
        Update: {
          bottle_id?: string
          created_at?: string
          id?: string
          rating_id?: string
          region?: string
          region_key?: string | null
          replaced_at?: string | null
          tier?: string
          user_id?: string
          wine_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "canon_wines_bottle_id_fkey"
            columns: ["bottle_id"]
            isOneToOne: false
            referencedRelation: "bottles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "canon_wines_rating_id_fkey"
            columns: ["rating_id"]
            isOneToOne: false
            referencedRelation: "ratings"
            referencedColumns: ["id"]
          },
        ]
      }
      fp_disputes: {
        Row: {
          bottle_id: string
          created_at: string
          delta: number
          id: string
          note: string | null
          predicted: number
          stars: number
          updated_at: string
          user_id: string
        }
        Insert: {
          bottle_id: string
          created_at?: string
          delta: number
          id?: string
          note?: string | null
          predicted: number
          stars: number
          updated_at?: string
          user_id: string
        }
        Update: {
          bottle_id?: string
          created_at?: string
          delta?: number
          id?: string
          note?: string | null
          predicted?: number
          stars?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fp_disputes_bottle_id_fkey"
            columns: ["bottle_id"]
            isOneToOne: false
            referencedRelation: "bottles"
            referencedColumns: ["id"]
          },
        ]
      }
      friendships: {
        Row: {
          addressee_id: string
          created_at: string
          id: string
          requester_id: string
          responded_at: string | null
          status: string
        }
        Insert: {
          addressee_id: string
          created_at?: string
          id?: string
          requester_id: string
          responded_at?: string | null
          status?: string
        }
        Update: {
          addressee_id?: string
          created_at?: string
          id?: string
          requester_id?: string
          responded_at?: string | null
          status?: string
        }
        Relationships: []
      }
      price_observations: {
        Row: {
          bottle_id: string | null
          created_at: string
          currency: string
          cuvee_key: string | null
          id: string
          menu_price: number
          observed_at: string
          raw_line: string | null
          restaurant_id: string
          scan_id: string | null
          source: string
          superseded: boolean
          user_id: string
        }
        Insert: {
          bottle_id?: string | null
          created_at?: string
          currency?: string
          cuvee_key?: string | null
          id?: string
          menu_price: number
          observed_at?: string
          raw_line?: string | null
          restaurant_id: string
          scan_id?: string | null
          source: string
          superseded?: boolean
          user_id?: string
        }
        Update: {
          bottle_id?: string | null
          created_at?: string
          currency?: string
          cuvee_key?: string | null
          id?: string
          menu_price?: number
          observed_at?: string
          raw_line?: string | null
          restaurant_id?: string
          scan_id?: string | null
          source?: string
          superseded?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "price_observations_bottle_id_fkey"
            columns: ["bottle_id"]
            isOneToOne: false
            referencedRelation: "bottles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_observations_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          n_rated: number
          onboarding_stage: string
          palate_code: string
          palate_code_red: string
          palate_code_white: string
          palate_version: number
          recent_groups: Json
          theme: string | null
          updated_at: string
          username: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id: string
          n_rated?: number
          onboarding_stage?: string
          palate_code?: string
          palate_code_red?: string
          palate_code_white?: string
          palate_version?: number
          recent_groups?: Json
          theme?: string | null
          updated_at?: string
          username: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          n_rated?: number
          onboarding_stage?: string
          palate_code?: string
          palate_code_red?: string
          palate_code_white?: string
          palate_version?: number
          recent_groups?: Json
          theme?: string | null
          updated_at?: string
          username?: string
        }
        Relationships: []
      }
      ratings: {
        Row: {
          bottle_id: string
          created_at: string
          id: string
          note: string | null
          stars: number
          updated_at: string
          user_id: string
        }
        Insert: {
          bottle_id: string
          created_at?: string
          id?: string
          note?: string | null
          stars: number
          updated_at?: string
          user_id: string
        }
        Update: {
          bottle_id?: string
          created_at?: string
          id?: string
          note?: string | null
          stars?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ratings_bottle_id_fkey"
            columns: ["bottle_id"]
            isOneToOne: false
            referencedRelation: "bottles"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurant_wines: {
        Row: {
          added_by: string | null
          bottle_id: string
          first_seen_at: string
          id: string
          last_seen_at: string
          menu_price: string | null
          menu_price_amount: number | null
          restaurant_id: string
          seen_count: number
          source_scan_id: string | null
        }
        Insert: {
          added_by?: string | null
          bottle_id: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          menu_price?: string | null
          menu_price_amount?: number | null
          restaurant_id: string
          seen_count?: number
          source_scan_id?: string | null
        }
        Update: {
          added_by?: string | null
          bottle_id?: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          menu_price?: string | null
          menu_price_amount?: number | null
          restaurant_id?: string
          seen_count?: number
          source_scan_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "restaurant_wines_bottle_id_fkey"
            columns: ["bottle_id"]
            isOneToOne: false
            referencedRelation: "bottles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restaurant_wines_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restaurant_wines_source_scan_id_fkey"
            columns: ["source_scan_id"]
            isOneToOne: false
            referencedRelation: "scan_logs"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurants: {
        Row: {
          city: string | null
          created_at: string
          created_by: string | null
          google_place_id: string | null
          id: string
          locale: string | null
          name: string
        }
        Insert: {
          city?: string | null
          created_at?: string
          created_by?: string | null
          google_place_id?: string | null
          id?: string
          locale?: string | null
          name: string
        }
        Update: {
          city?: string | null
          created_at?: string
          created_by?: string | null
          google_place_id?: string | null
          id?: string
          locale?: string | null
          name?: string
        }
        Relationships: []
      }
      scan_logs: {
        Row: {
          created_at: string
          estimated_count: number
          id: string
          image_paths: string[]
          matched_count: number
          n_photos: number
          raw_vision: Json | null
          restaurant_id: string | null
          status: string
          total_wines: number
          unreadable_count: number
          user_id: string
          wines: Json
        }
        Insert: {
          created_at?: string
          estimated_count?: number
          id?: string
          image_paths?: string[]
          matched_count?: number
          n_photos?: number
          raw_vision?: Json | null
          restaurant_id?: string | null
          status?: string
          total_wines?: number
          unreadable_count?: number
          user_id: string
          wines?: Json
        }
        Update: {
          created_at?: string
          estimated_count?: number
          id?: string
          image_paths?: string[]
          matched_count?: number
          n_photos?: number
          raw_vision?: Json | null
          restaurant_id?: string | null
          status?: string
          total_wines?: number
          unreadable_count?: number
          user_id?: string
          wines?: Json
        }
        Relationships: []
      }
      scan_wines: {
        Row: {
          batch_index: number
          created_at: string
          cuvee: string | null
          fp: Json | null
          fp_source: string | null
          grape: string | null
          id: string
          match_reasons: Json | null
          match_score: number | null
          matched_bottle_id: string | null
          predicted_stars: number | null
          price: string | null
          producer: string | null
          raw_json: Json | null
          region: string | null
          scan_id: string
          user_id: string
          vintage: number | null
          wine_type: string | null
        }
        Insert: {
          batch_index?: number
          created_at?: string
          cuvee?: string | null
          fp?: Json | null
          fp_source?: string | null
          grape?: string | null
          id?: string
          match_reasons?: Json | null
          match_score?: number | null
          matched_bottle_id?: string | null
          predicted_stars?: number | null
          price?: string | null
          producer?: string | null
          raw_json?: Json | null
          region?: string | null
          scan_id: string
          user_id: string
          vintage?: number | null
          wine_type?: string | null
        }
        Update: {
          batch_index?: number
          created_at?: string
          cuvee?: string | null
          fp?: Json | null
          fp_source?: string | null
          grape?: string | null
          id?: string
          match_reasons?: Json | null
          match_score?: number | null
          matched_bottle_id?: string | null
          predicted_stars?: number | null
          price?: string | null
          producer?: string | null
          raw_json?: Json | null
          region?: string | null
          scan_id?: string
          user_id?: string
          vintage?: number | null
          wine_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scan_wines_scan_id_fkey"
            columns: ["scan_id"]
            isOneToOne: false
            referencedRelation: "scans"
            referencedColumns: ["id"]
          },
        ]
      }
      scans: {
        Row: {
          batch_count: number
          batches_done: number
          batches_failed: Json
          created_at: string
          id: string
          image_paths: Json
          page_count: number
          restaurant_id: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          batch_count?: number
          batches_done?: number
          batches_failed?: Json
          created_at?: string
          id?: string
          image_paths?: Json
          page_count?: number
          restaurant_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          batch_count?: number
          batches_done?: number
          batches_failed?: Json
          created_at?: string
          id?: string
          image_paths?: Json
          page_count?: number
          restaurant_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scans_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      are_friends: { Args: { _a: string; _b: string }; Returns: boolean }
      mark_scan_batch_done: {
        Args: { p_batch_index: number; p_scan_id: string }
        Returns: undefined
      }
      mark_scan_batch_failed: {
        Args: { p_batch_index: number; p_scan_id: string }
        Returns: undefined
      }
      resolve_username_to_id: { Args: { p_username: string }; Returns: string }
      restaurant_cuvee_history: {
        Args: { p_cuvee_key: string; p_restaurant_id: string }
        Returns: {
          menu_price: number
          observed_at: string
          source: string
        }[]
      }
      restaurant_price_stats: {
        Args: { p_restaurant_id: string }
        Returns: {
          last_observed_at: string
          median_menu_price: number
          observation_count: number
        }[]
      }
      restore_rating_and_benchmark: {
        Args: {
          p_bottle_id: string
          p_predicted?: number
          p_stars: number
          p_tier: string
        }
        Returns: {
          benchmark_id: string
          palate_version: number
        }[]
      }
      rpc_fingerprint_reach: {
        Args: {
          p_fp_acid: number
          p_fp_body: number
          p_fp_fresh: number
          p_fp_fruit_dark: number
          p_fp_oak: number
          p_fp_ripe: number
          p_fp_savory: number
          p_fp_tannin: number
          p_h?: number
          p_sample_size?: number
          p_wine_type: string
        }
        Returns: number
      }
      rpc_pour_candidates: {
        Args: {
          excluded_ids?: string[]
          loved: Json
          overall_cap?: number
          per_loved?: number
          per_type_critic?: number
          rated_types: string[]
        }
        Returns: {
          added_by: string
          ax_acidity: number
          ax_body: number
          ax_fruit_char: number
          ax_sweet: number
          ax_tannin: number
          critic_score: number
          fp_acid: number
          fp_body: number
          fp_fresh: number
          fp_fruit_dark: number
          fp_oak: number
          fp_ripe: number
          fp_savory: number
          fp_tannin: number
          grape: string
          id: string
          name: string
          price_band: string
          producer: string
          region: string
          source: string
          tasting_note: string
          type: string
          vintage: number
        }[]
      }
      save_rating_with_cascade: {
        Args: { p_bottle_id: string; p_predicted?: number; p_stars: number }
        Returns: {
          demoted_tier: string
          palate_version: number
          previous_stars: number
        }[]
      }
      search_bottles_fuzzy: {
        Args: {
          lim?: number
          q: string
          threshold?: number
          type_variants?: string[]
        }
        Returns: {
          added_by: string | null
          ax_acidity: number
          ax_body: number
          ax_fruit_char: number
          ax_sweet: number
          ax_tannin: number
          country: string | null
          created_at: string
          critic_score: number | null
          excluded_from_recs: boolean
          fp_acid: number
          fp_body: number
          fp_dispute_count: number
          fp_fresh: number
          fp_fruit_dark: number
          fp_harmonized_at: string | null
          fp_oak: number
          fp_ripe: number
          fp_savory: number
          fp_tannin: number
          fp_vec: string | null
          grape: string | null
          id: string
          name: string
          price_band: string | null
          producer: string | null
          refingerprinted_at: string | null
          region: string | null
          source: string | null
          tasting_note: string | null
          type: string
          unverified: boolean
          vintage: number | null
        }[]
        SetofOptions: {
          from: "*"
          to: "bottles"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      search_restaurants: {
        Args: { lim?: number; q: string }
        Returns: {
          city: string
          id: string
          locale: string
          name: string
        }[]
      }
      search_users: {
        Args: { lim?: number; q: string }
        Returns: {
          display_name: string
          user_id: string
          username: string
        }[]
      }
      set_benchmark: {
        Args: { p_action: string; p_bottle_id: string; p_tier: string }
        Returns: {
          benchmark_id: string
          palate_version: number
          replaced_id: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
