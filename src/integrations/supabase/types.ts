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
          fp_acid: number
          fp_body: number
          fp_fresh: number
          fp_fruit_dark: number
          fp_oak: number
          fp_ripe: number
          fp_savory: number
          fp_tannin: number
          grape: string | null
          id: string
          name: string
          price_band: string | null
          producer: string | null
          region: string | null
          source: string | null
          tasting_note: string | null
          type: string
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
          fp_acid?: number
          fp_body?: number
          fp_fresh?: number
          fp_fruit_dark?: number
          fp_oak?: number
          fp_ripe?: number
          fp_savory?: number
          fp_tannin?: number
          grape?: string | null
          id?: string
          name: string
          price_band?: string | null
          producer?: string | null
          region?: string | null
          source?: string | null
          tasting_note?: string | null
          type?: string
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
          fp_acid?: number
          fp_body?: number
          fp_fresh?: number
          fp_fruit_dark?: number
          fp_oak?: number
          fp_ripe?: number
          fp_savory?: number
          fp_tannin?: number
          grape?: string | null
          id?: string
          name?: string
          price_band?: string | null
          producer?: string | null
          region?: string | null
          source?: string | null
          tasting_note?: string | null
          type?: string
          vintage?: number | null
        }
        Relationships: []
      }
      bottles_llm_staging: {
        Row: {
          ax_acidity: number | null
          ax_body: number | null
          ax_fruit_char: number | null
          ax_sweet: number | null
          ax_tannin: number | null
          critic_score: string | null
          fp_acid: number | null
          fp_body: number | null
          fp_fresh: number | null
          fp_fruit_dark: number | null
          fp_oak: number | null
          fp_ripe: number | null
          fp_savory: number | null
          fp_tannin: number | null
          grape: string | null
          name: string | null
          price_band: string | null
          producer: string | null
          region: string | null
          source: string | null
          type: string | null
          vintage: string | null
        }
        Insert: {
          ax_acidity?: number | null
          ax_body?: number | null
          ax_fruit_char?: number | null
          ax_sweet?: number | null
          ax_tannin?: number | null
          critic_score?: string | null
          fp_acid?: number | null
          fp_body?: number | null
          fp_fresh?: number | null
          fp_fruit_dark?: number | null
          fp_oak?: number | null
          fp_ripe?: number | null
          fp_savory?: number | null
          fp_tannin?: number | null
          grape?: string | null
          name?: string | null
          price_band?: string | null
          producer?: string | null
          region?: string | null
          source?: string | null
          type?: string | null
          vintage?: string | null
        }
        Update: {
          ax_acidity?: number | null
          ax_body?: number | null
          ax_fruit_char?: number | null
          ax_sweet?: number | null
          ax_tannin?: number | null
          critic_score?: string | null
          fp_acid?: number | null
          fp_body?: number | null
          fp_fresh?: number | null
          fp_fruit_dark?: number | null
          fp_oak?: number | null
          fp_ripe?: number | null
          fp_savory?: number | null
          fp_tannin?: number | null
          grape?: string | null
          name?: string | null
          price_band?: string | null
          producer?: string | null
          region?: string | null
          source?: string | null
          type?: string | null
          vintage?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          id: string
          n_rated: number
          palate_code: string
          palate_code_red: string
          palate_code_white: string
          theme: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id: string
          n_rated?: number
          palate_code?: string
          palate_code_red?: string
          palate_code_white?: string
          theme?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          n_rated?: number
          palate_code?: string
          palate_code_red?: string
          palate_code_white?: string
          theme?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      ratings: {
        Row: {
          bottle_id: string
          created_at: string
          id: string
          stars: number
          updated_at: string
          user_id: string
        }
        Insert: {
          bottle_id: string
          created_at?: string
          id?: string
          stars: number
          updated_at?: string
          user_id: string
        }
        Update: {
          bottle_id?: string
          created_at?: string
          id?: string
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
      scan_logs: {
        Row: {
          created_at: string
          estimated_count: number
          id: string
          matched_count: number
          n_photos: number
          raw_vision: Json | null
          total_wines: number
          unreadable_count: number
          user_id: string
          wines: Json
        }
        Insert: {
          created_at?: string
          estimated_count?: number
          id?: string
          matched_count?: number
          n_photos?: number
          raw_vision?: Json | null
          total_wines?: number
          unreadable_count?: number
          user_id: string
          wines?: Json
        }
        Update: {
          created_at?: string
          estimated_count?: number
          id?: string
          matched_count?: number
          n_photos?: number
          raw_vision?: Json | null
          total_wines?: number
          unreadable_count?: number
          user_id?: string
          wines?: Json
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
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
          fp_acid: number
          fp_body: number
          fp_fresh: number
          fp_fruit_dark: number
          fp_oak: number
          fp_ripe: number
          fp_savory: number
          fp_tannin: number
          grape: string | null
          id: string
          name: string
          price_band: string | null
          producer: string | null
          region: string | null
          source: string | null
          tasting_note: string | null
          type: string
          vintage: number | null
        }[]
        SetofOptions: {
          from: "*"
          to: "bottles"
          isOneToOne: false
          isSetofReturn: true
        }
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
