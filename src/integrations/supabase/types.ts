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
      admin_type_review_rejects: {
        Row: {
          bottle_id: string
          note: string | null
          rejected_at: string
          rejected_by: string | null
        }
        Insert: {
          bottle_id: string
          note?: string | null
          rejected_at?: string
          rejected_by?: string | null
        }
        Update: {
          bottle_id?: string
          note?: string | null
          rejected_at?: string
          rejected_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_type_review_rejects_bottle_id_fkey"
            columns: ["bottle_id"]
            isOneToOne: true
            referencedRelation: "bottles"
            referencedColumns: ["id"]
          },
        ]
      }
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
          fingerprint_attempts: number
          fp_acid: number
          fp_acid_prior: number
          fp_body: number
          fp_body_prior: number
          fp_dispute_count: number
          fp_fresh: number
          fp_fresh_prior: number
          fp_fruit_dark: number
          fp_fruit_dark_prior: number
          fp_harmonized_at: string | null
          fp_job_id: string | null
          fp_model: string
          fp_oak: number
          fp_oak_prior: number
          fp_pipeline: string
          fp_prior_precision: number
          fp_prompt_hash: string
          fp_ripe: number
          fp_ripe_prior: number
          fp_savory: number
          fp_savory_prior: number
          fp_scored_at: string
          fp_tannin: number
          fp_tannin_prior: number
          fp_vec: string | null
          grape: string | null
          id: string
          last_attempt_at: string | null
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
          ax_sweet: number
          ax_tannin?: number
          country?: string | null
          created_at?: string
          critic_score?: number | null
          excluded_from_recs?: boolean
          fingerprint_attempts?: number
          fp_acid: number
          fp_acid_prior?: number
          fp_body: number
          fp_body_prior?: number
          fp_dispute_count?: number
          fp_fresh: number
          fp_fresh_prior?: number
          fp_fruit_dark: number
          fp_fruit_dark_prior?: number
          fp_harmonized_at?: string | null
          fp_job_id?: string | null
          fp_model: string
          fp_oak: number
          fp_oak_prior?: number
          fp_pipeline: string
          fp_prior_precision?: number
          fp_prompt_hash: string
          fp_ripe: number
          fp_ripe_prior?: number
          fp_savory: number
          fp_savory_prior?: number
          fp_scored_at: string
          fp_tannin: number
          fp_tannin_prior?: number
          fp_vec?: string | null
          grape?: string | null
          id?: string
          last_attempt_at?: string | null
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
          fingerprint_attempts?: number
          fp_acid?: number
          fp_acid_prior?: number
          fp_body?: number
          fp_body_prior?: number
          fp_dispute_count?: number
          fp_fresh?: number
          fp_fresh_prior?: number
          fp_fruit_dark?: number
          fp_fruit_dark_prior?: number
          fp_harmonized_at?: string | null
          fp_job_id?: string | null
          fp_model?: string
          fp_oak?: number
          fp_oak_prior?: number
          fp_pipeline?: string
          fp_prior_precision?: number
          fp_prompt_hash?: string
          fp_ripe?: number
          fp_ripe_prior?: number
          fp_savory?: number
          fp_savory_prior?: number
          fp_scored_at?: string
          fp_tannin?: number
          fp_tannin_prior?: number
          fp_vec?: string | null
          grape?: string | null
          id?: string
          last_attempt_at?: string | null
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
        Relationships: [
          {
            foreignKeyName: "bottles_fp_job_id_fkey"
            columns: ["fp_job_id"]
            isOneToOne: false
            referencedRelation: "catalog_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      call_instrumentation: {
        Row: {
          created_at: string
          id: string
          is_catalog: boolean
          list_size: number
          n_priced: number
          palate_version: number | null
          price_position: string
          scan_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_catalog: boolean
          list_size: number
          n_priced?: number
          palate_version?: number | null
          price_position: string
          scan_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_catalog?: boolean
          list_size?: number
          n_priced?: number
          palate_version?: number | null
          price_position?: string
          scan_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "call_instrumentation_scan_id_fkey"
            columns: ["scan_id"]
            isOneToOne: false
            referencedRelation: "scans"
            referencedColumns: ["id"]
          },
        ]
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
      catalog_corrections: {
        Row: {
          author_id: string | null
          bottle_id: string
          created_at: string
          field: string
          id: string
          new_value: string | null
          old_value: string | null
          rationale: string | null
          source_type: string
        }
        Insert: {
          author_id?: string | null
          bottle_id: string
          created_at?: string
          field: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          rationale?: string | null
          source_type: string
        }
        Update: {
          author_id?: string | null
          bottle_id?: string
          created_at?: string
          field?: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          rationale?: string | null
          source_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_corrections_bottle_id_fkey"
            columns: ["bottle_id"]
            isOneToOne: false
            referencedRelation: "bottles"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_jobs: {
        Row: {
          actor_id: string | null
          commit_sha: string | null
          finished_at: string | null
          id: string
          kind: string
          model: string | null
          note: string | null
          prompt_hash: string | null
          row_count: number | null
          started_at: string
        }
        Insert: {
          actor_id?: string | null
          commit_sha?: string | null
          finished_at?: string | null
          id?: string
          kind: string
          model?: string | null
          note?: string | null
          prompt_hash?: string | null
          row_count?: number | null
          started_at?: string
        }
        Update: {
          actor_id?: string | null
          commit_sha?: string | null
          finished_at?: string | null
          id?: string
          kind?: string
          model?: string | null
          note?: string | null
          prompt_hash?: string | null
          row_count?: number | null
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_jobs_prompt_hash_fkey"
            columns: ["prompt_hash"]
            isOneToOne: false
            referencedRelation: "fingerprint_prompts"
            referencedColumns: ["hash"]
          },
        ]
      }
      feedback: {
        Row: {
          app_version: string | null
          category: string
          context: Json | null
          created_at: string
          id: string
          message: string | null
          prompt_key: string | null
          rating: string | null
          screen: string | null
          screenshot_url: string | null
          source: string
          status: string
          user_id: string
        }
        Insert: {
          app_version?: string | null
          category: string
          context?: Json | null
          created_at?: string
          id?: string
          message?: string | null
          prompt_key?: string | null
          rating?: string | null
          screen?: string | null
          screenshot_url?: string | null
          source?: string
          status?: string
          user_id: string
        }
        Update: {
          app_version?: string | null
          category?: string
          context?: Json | null
          created_at?: string
          id?: string
          message?: string | null
          prompt_key?: string | null
          rating?: string | null
          screen?: string | null
          screenshot_url?: string | null
          source?: string
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      fingerprint_prompts: {
        Row: {
          first_seen_at: string
          hash: string
          text: string
        }
        Insert: {
          first_seen_at?: string
          hash: string
          text: string
        }
        Update: {
          first_seen_at?: string
          hash?: string
          text?: string
        }
        Relationships: []
      }
      follows: {
        Row: {
          created_at: string
          followee_id: string
          follower_id: string
          id: string
          responded_at: string | null
          status: string
        }
        Insert: {
          created_at?: string
          followee_id: string
          follower_id: string
          id?: string
          responded_at?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          followee_id?: string
          follower_id?: string
          id?: string
          responded_at?: string | null
          status?: string
        }
        Relationships: []
      }
      founder_accounts: {
        Row: {
          added_at: string
          id: string
          tagline: string | null
        }
        Insert: {
          added_at?: string
          id: string
          tagline?: string | null
        }
        Update: {
          added_at?: string
          id?: string
          tagline?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "founder_accounts_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      fp_consensus_candidates: {
        Row: {
          axis: string
          bottle_id: string
          created_at: string
          eligible: boolean
          id: string
          mean_residual: number
          n_palate_codes: number
          n_raters: number
          prior_value: number
          proposed_value: number
          reason: string | null
          run_id: string
          sign_consistency: number
          written_observation_id: string | null
        }
        Insert: {
          axis: string
          bottle_id: string
          created_at?: string
          eligible: boolean
          id?: string
          mean_residual: number
          n_palate_codes: number
          n_raters: number
          prior_value: number
          proposed_value: number
          reason?: string | null
          run_id: string
          sign_consistency: number
          written_observation_id?: string | null
        }
        Update: {
          axis?: string
          bottle_id?: string
          created_at?: string
          eligible?: boolean
          id?: string
          mean_residual?: number
          n_palate_codes?: number
          n_raters?: number
          prior_value?: number
          proposed_value?: number
          reason?: string | null
          run_id?: string
          sign_consistency?: number
          written_observation_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fp_consensus_candidates_bottle_id_fkey"
            columns: ["bottle_id"]
            isOneToOne: false
            referencedRelation: "bottles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fp_consensus_candidates_written_observation_id_fkey"
            columns: ["written_observation_id"]
            isOneToOne: false
            referencedRelation: "fp_observations"
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
      fp_observations: {
        Row: {
          author_id: string | null
          axis: string
          bottle_id: string
          created_at: string
          id: string
          mode: string
          observed_value: number
          precision: number
          rationale: string | null
          reliability_at_write: number | null
          source_type: string
          superseded: boolean
        }
        Insert: {
          author_id?: string | null
          axis: string
          bottle_id: string
          created_at?: string
          id?: string
          mode?: string
          observed_value: number
          precision: number
          rationale?: string | null
          reliability_at_write?: number | null
          source_type: string
          superseded?: boolean
        }
        Update: {
          author_id?: string | null
          axis?: string
          bottle_id?: string
          created_at?: string
          id?: string
          mode?: string
          observed_value?: number
          precision?: number
          rationale?: string | null
          reliability_at_write?: number | null
          source_type?: string
          superseded?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "fp_observations_bottle_id_fkey"
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
      house_list_items: {
        Row: {
          bottle_id: string | null
          corrected: boolean
          created_at: string
          currency: string | null
          format: string
          id: string
          price_amount: number | null
          raw_cuvee: string | null
          raw_producer: string | null
          raw_vintage: number | null
          version_id: string
        }
        Insert: {
          bottle_id?: string | null
          corrected?: boolean
          created_at?: string
          currency?: string | null
          format?: string
          id?: string
          price_amount?: number | null
          raw_cuvee?: string | null
          raw_producer?: string | null
          raw_vintage?: number | null
          version_id: string
        }
        Update: {
          bottle_id?: string | null
          corrected?: boolean
          created_at?: string
          currency?: string | null
          format?: string
          id?: string
          price_amount?: number | null
          raw_cuvee?: string | null
          raw_producer?: string | null
          raw_vintage?: number | null
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "house_list_items_bottle_id_fkey"
            columns: ["bottle_id"]
            isOneToOne: false
            referencedRelation: "bottles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "house_list_items_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "house_list_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      house_list_stock: {
        Row: {
          bottle_id: string
          house_list_id: string
          out_of_stock: boolean
          updated_at: string
          updated_by: string
        }
        Insert: {
          bottle_id: string
          house_list_id: string
          out_of_stock?: boolean
          updated_at?: string
          updated_by: string
        }
        Update: {
          bottle_id?: string
          house_list_id?: string
          out_of_stock?: boolean
          updated_at?: string
          updated_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "house_list_stock_house_list_id_fkey"
            columns: ["house_list_id"]
            isOneToOne: false
            referencedRelation: "house_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      house_list_versions: {
        Row: {
          created_at: string
          created_by: string
          house_list_id: string
          id: string
          scan_id: string | null
          version: number
        }
        Insert: {
          created_at?: string
          created_by: string
          house_list_id: string
          id?: string
          scan_id?: string | null
          version: number
        }
        Update: {
          created_at?: string
          created_by?: string
          house_list_id?: string
          id?: string
          scan_id?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "house_list_versions_house_list_id_fkey"
            columns: ["house_list_id"]
            isOneToOne: false
            referencedRelation: "house_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "house_list_versions_scan_id_fkey"
            columns: ["scan_id"]
            isOneToOne: false
            referencedRelation: "scans"
            referencedColumns: ["id"]
          },
        ]
      }
      house_lists: {
        Row: {
          active_version_id: string | null
          created_at: string
          establishment: string
          id: string
          owner_id: string
          updated_at: string
        }
        Insert: {
          active_version_id?: string | null
          created_at?: string
          establishment: string
          id?: string
          owner_id: string
          updated_at?: string
        }
        Update: {
          active_version_id?: string | null
          created_at?: string
          establishment?: string
          id?: string
          owner_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "house_lists_active_version_fk"
            columns: ["active_version_id"]
            isOneToOne: false
            referencedRelation: "house_list_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      invites: {
        Row: {
          created_at: string
          id: string
          inviter_id: string
          kind: string
          redeemed_at: string | null
          redeemed_by: string | null
          redemption_count: number
          scan_id: string | null
          token: string
        }
        Insert: {
          created_at?: string
          id?: string
          inviter_id: string
          kind: string
          redeemed_at?: string | null
          redeemed_by?: string | null
          redemption_count?: number
          scan_id?: string | null
          token: string
        }
        Update: {
          created_at?: string
          id?: string
          inviter_id?: string
          kind?: string
          redeemed_at?: string | null
          redeemed_by?: string | null
          redemption_count?: number
          scan_id?: string | null
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "invites_scan_id_fkey"
            columns: ["scan_id"]
            isOneToOne: false
            referencedRelation: "scans"
            referencedColumns: ["id"]
          },
        ]
      }
      prediction_outcomes: {
        Row: {
          axis_deltas: Json | null
          bandwidth: number | null
          bottle_id: string
          created_at: string
          delta: number | null
          fp_pipeline: string
          id: string
          miss_attribution: string | null
          n_rated_at_prediction: number | null
          neighbor_support: number | null
          null_reason: string | null
          omega: Json | null
          palate_version: number | null
          predicted: number | null
          predicted_rank: number | null
          scan_id: string | null
          scan_wine_id: string | null
          source: string
          stars: number
          user_id: string
        }
        Insert: {
          axis_deltas?: Json | null
          bandwidth?: number | null
          bottle_id: string
          created_at?: string
          delta?: number | null
          fp_pipeline?: string
          id?: string
          miss_attribution?: string | null
          n_rated_at_prediction?: number | null
          neighbor_support?: number | null
          null_reason?: string | null
          omega?: Json | null
          palate_version?: number | null
          predicted?: number | null
          predicted_rank?: number | null
          scan_id?: string | null
          scan_wine_id?: string | null
          source?: string
          stars: number
          user_id?: string
        }
        Update: {
          axis_deltas?: Json | null
          bandwidth?: number | null
          bottle_id?: string
          created_at?: string
          delta?: number | null
          fp_pipeline?: string
          id?: string
          miss_attribution?: string | null
          n_rated_at_prediction?: number | null
          neighbor_support?: number | null
          null_reason?: string | null
          omega?: Json | null
          palate_version?: number | null
          predicted?: number | null
          predicted_rank?: number | null
          scan_id?: string | null
          scan_wine_id?: string | null
          source?: string
          stars?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prediction_outcomes_bottle_id_fkey"
            columns: ["bottle_id"]
            isOneToOne: false
            referencedRelation: "bottles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prediction_outcomes_scan_id_fkey"
            columns: ["scan_id"]
            isOneToOne: false
            referencedRelation: "scans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prediction_outcomes_scan_wine_id_fkey"
            columns: ["scan_wine_id"]
            isOneToOne: false
            referencedRelation: "scan_wines"
            referencedColumns: ["id"]
          },
        ]
      }
      price_observations: {
        Row: {
          bottle_id: string | null
          created_at: string
          currency: string
          cuvee_key: string | null
          format: string
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
          format?: string
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
          format?: string
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
          avatar_url: string | null
          bio: string | null
          bypass_code_used: string | null
          created_at: string
          display_name: string | null
          establishment: string | null
          id: string
          last_seen_at: string | null
          n_rated: number
          onboarding_stage: string
          palate_code: string
          palate_code_red: string
          palate_code_white: string
          palate_shareable: boolean
          palate_version: number
          quiz_answers: Json | null
          quiz_completed_at: string | null
          recent_groups: Json
          scan_unlock_seen: boolean
          somm_role: string | null
          somm_status: string
          theme: string | null
          updated_at: string
          username: string
          verified_at: string | null
          verified_by: string | null
          visibility: string
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          bypass_code_used?: string | null
          created_at?: string
          display_name?: string | null
          establishment?: string | null
          id: string
          last_seen_at?: string | null
          n_rated?: number
          onboarding_stage?: string
          palate_code?: string
          palate_code_red?: string
          palate_code_white?: string
          palate_shareable?: boolean
          palate_version?: number
          quiz_answers?: Json | null
          quiz_completed_at?: string | null
          recent_groups?: Json
          scan_unlock_seen?: boolean
          somm_role?: string | null
          somm_status?: string
          theme?: string | null
          updated_at?: string
          username: string
          verified_at?: string | null
          verified_by?: string | null
          visibility?: string
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          bypass_code_used?: string | null
          created_at?: string
          display_name?: string | null
          establishment?: string | null
          id?: string
          last_seen_at?: string | null
          n_rated?: number
          onboarding_stage?: string
          palate_code?: string
          palate_code_red?: string
          palate_code_white?: string
          palate_shareable?: boolean
          palate_version?: number
          quiz_answers?: Json | null
          quiz_completed_at?: string | null
          recent_groups?: Json
          scan_unlock_seen?: boolean
          somm_role?: string | null
          somm_status?: string
          theme?: string | null
          updated_at?: string
          username?: string
          verified_at?: string | null
          verified_by?: string | null
          visibility?: string
        }
        Relationships: []
      }
      rating_share_optout: {
        Row: {
          created_at: string
          rating_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          rating_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          rating_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rating_share_optout_rating_id_fkey"
            columns: ["rating_id"]
            isOneToOne: false
            referencedRelation: "ratings"
            referencedColumns: ["id"]
          },
        ]
      }
      ratings: {
        Row: {
          bottle_id: string
          created_at: string
          id: string
          note: string | null
          photo_path: string | null
          photo_shared: boolean
          stars: number
          updated_at: string
          user_id: string
        }
        Insert: {
          bottle_id: string
          created_at?: string
          id?: string
          note?: string | null
          photo_path?: string | null
          photo_shared?: boolean
          stars: number
          updated_at?: string
          user_id: string
        }
        Update: {
          bottle_id?: string
          created_at?: string
          id?: string
          note?: string | null
          photo_path?: string | null
          photo_shared?: boolean
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
      restaurant_saves: {
        Row: {
          created_at: string
          id: string
          restaurant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          restaurant_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          restaurant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "restaurant_saves_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurant_wines: {
        Row: {
          added_by: string | null
          bottle_id: string
          first_seen_at: string
          format: string
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
          format?: string
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
          format?: string
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
          currency: string | null
          google_place_id: string | null
          id: string
          locale: string | null
          name: string
          neighborhood: string | null
          phone: string | null
          possible_duplicate: boolean
          reservation_url: string | null
          venue_raw_text_last: string | null
        }
        Insert: {
          city?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string | null
          google_place_id?: string | null
          id?: string
          locale?: string | null
          name: string
          neighborhood?: string | null
          phone?: string | null
          possible_duplicate?: boolean
          reservation_url?: string | null
          venue_raw_text_last?: string | null
        }
        Update: {
          city?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string | null
          google_place_id?: string | null
          id?: string
          locale?: string | null
          name?: string
          neighborhood?: string | null
          phone?: string | null
          possible_duplicate?: boolean
          reservation_url?: string | null
          venue_raw_text_last?: string | null
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
      scan_outcomes: {
        Row: {
          call_bottle_id: string | null
          call_predicted: number | null
          call_price: number | null
          chosen_bottle_id: string
          chosen_fp_pipeline: string | null
          chosen_predicted: number | null
          chosen_price: number | null
          chosen_rank: number | null
          created_at: string
          id: string
          list_price_median: number | null
          n_candidates: number | null
          scan_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          call_bottle_id?: string | null
          call_predicted?: number | null
          call_price?: number | null
          chosen_bottle_id: string
          chosen_fp_pipeline?: string | null
          chosen_predicted?: number | null
          chosen_price?: number | null
          chosen_rank?: number | null
          created_at?: string
          id?: string
          list_price_median?: number | null
          n_candidates?: number | null
          scan_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          call_bottle_id?: string | null
          call_predicted?: number | null
          call_price?: number | null
          chosen_bottle_id?: string
          chosen_fp_pipeline?: string | null
          chosen_predicted?: number | null
          chosen_price?: number | null
          chosen_rank?: number | null
          created_at?: string
          id?: string
          list_price_median?: number | null
          n_candidates?: number | null
          scan_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scan_outcomes_call_bottle_id_fkey"
            columns: ["call_bottle_id"]
            isOneToOne: false
            referencedRelation: "bottles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scan_outcomes_chosen_bottle_id_fkey"
            columns: ["chosen_bottle_id"]
            isOneToOne: false
            referencedRelation: "bottles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scan_outcomes_scan_id_fkey"
            columns: ["scan_id"]
            isOneToOne: false
            referencedRelation: "scans"
            referencedColumns: ["id"]
          },
        ]
      }
      scan_wine_corrections: {
        Row: {
          created_at: string
          field: string
          id: string
          new_value: string | null
          old_value: string | null
          scan_wine_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          field: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          scan_wine_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          field?: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          scan_wine_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scan_wine_corrections_scan_wine_id_fkey"
            columns: ["scan_wine_id"]
            isOneToOne: false
            referencedRelation: "scan_wines"
            referencedColumns: ["id"]
          },
        ]
      }
      scan_wines: {
        Row: {
          batch_index: number
          created_at: string
          currency: string
          cuvee: string | null
          format: string
          fp: Json | null
          fp_source: string | null
          grape: string | null
          id: string
          match_reasons: Json | null
          match_score: number | null
          matched_bottle_id: string | null
          predicted_stars: number | null
          price: string | null
          price_amount: number | null
          producer: string | null
          rated_at: string | null
          raw_json: Json | null
          raw_ocr_text: string | null
          raw_text: string | null
          region: string | null
          scan_id: string
          user_id: string
          user_rated_stars: number | null
          vintage: number | null
          wine_type: string | null
        }
        Insert: {
          batch_index?: number
          created_at?: string
          currency?: string
          cuvee?: string | null
          format?: string
          fp?: Json | null
          fp_source?: string | null
          grape?: string | null
          id?: string
          match_reasons?: Json | null
          match_score?: number | null
          matched_bottle_id?: string | null
          predicted_stars?: number | null
          price?: string | null
          price_amount?: number | null
          producer?: string | null
          rated_at?: string | null
          raw_json?: Json | null
          raw_ocr_text?: string | null
          raw_text?: string | null
          region?: string | null
          scan_id: string
          user_id: string
          user_rated_stars?: number | null
          vintage?: number | null
          wine_type?: string | null
        }
        Update: {
          batch_index?: number
          created_at?: string
          currency?: string
          cuvee?: string | null
          format?: string
          fp?: Json | null
          fp_source?: string | null
          grape?: string | null
          id?: string
          match_reasons?: Json | null
          match_score?: number | null
          matched_bottle_id?: string | null
          predicted_stars?: number | null
          price?: string | null
          price_amount?: number | null
          producer?: string | null
          rated_at?: string | null
          raw_json?: Json | null
          raw_ocr_text?: string | null
          raw_text?: string | null
          region?: string | null
          scan_id?: string
          user_id?: string
          user_rated_stars?: number | null
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
          back_image_path: string | null
          batch_count: number
          batches_done: number
          batches_failed: Json
          created_at: string
          currency: string | null
          front_image_path: string | null
          id: string
          image_paths: Json
          kind: string
          page_count: number
          restaurant_id: string | null
          scanned_at: string
          share_token: string | null
          status: string
          updated_at: string
          user_id: string
          venue_raw_text: string | null
        }
        Insert: {
          back_image_path?: string | null
          batch_count?: number
          batches_done?: number
          batches_failed?: Json
          created_at?: string
          currency?: string | null
          front_image_path?: string | null
          id?: string
          image_paths?: Json
          kind?: string
          page_count?: number
          restaurant_id?: string | null
          scanned_at?: string
          share_token?: string | null
          status?: string
          updated_at?: string
          user_id: string
          venue_raw_text?: string | null
        }
        Update: {
          back_image_path?: string | null
          batch_count?: number
          batches_done?: number
          batches_failed?: Json
          created_at?: string
          currency?: string | null
          front_image_path?: string | null
          id?: string
          image_paths?: Json
          kind?: string
          page_count?: number
          restaurant_id?: string | null
          scanned_at?: string
          share_token?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          venue_raw_text?: string | null
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
      somm_access_log: {
        Row: {
          candidate_count: number
          establishment: string | null
          grant_id: string | null
          guest_id: string
          id: string
          kind: string
          occurred_at: string
          somm_id: string
          via: string
        }
        Insert: {
          candidate_count: number
          establishment?: string | null
          grant_id?: string | null
          guest_id: string
          id?: string
          kind?: string
          occurred_at?: string
          somm_id: string
          via: string
        }
        Update: {
          candidate_count?: number
          establishment?: string | null
          grant_id?: string | null
          guest_id?: string
          id?: string
          kind?: string
          occurred_at?: string
          somm_id?: string
          via?: string
        }
        Relationships: [
          {
            foreignKeyName: "somm_access_log_grant_id_fkey"
            columns: ["grant_id"]
            isOneToOne: false
            referencedRelation: "somm_consent_grants"
            referencedColumns: ["id"]
          },
        ]
      }
      somm_consent_grants: {
        Row: {
          claimed_at: string | null
          code: string
          created_at: string
          expires_at: string
          granted_to_somm_id: string | null
          guest_id: string
          id: string
          used_at: string | null
        }
        Insert: {
          claimed_at?: string | null
          code: string
          created_at?: string
          expires_at: string
          granted_to_somm_id?: string | null
          guest_id: string
          id?: string
          used_at?: string | null
        }
        Update: {
          claimed_at?: string | null
          code?: string
          created_at?: string
          expires_at?: string
          granted_to_somm_id?: string | null
          guest_id?: string
          id?: string
          used_at?: string | null
        }
        Relationships: []
      }
      somm_invite_codes: {
        Row: {
          code: string
          created_at: string
          issued_by: string | null
          note: string | null
          revoked_at: string | null
          used_at: string | null
          used_by: string | null
        }
        Insert: {
          code: string
          created_at?: string
          issued_by?: string | null
          note?: string | null
          revoked_at?: string | null
          used_at?: string | null
          used_by?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          issued_by?: string | null
          note?: string | null
          revoked_at?: string | null
          used_at?: string | null
          used_by?: string | null
        }
        Relationships: []
      }
      user_reliability: {
        Row: {
          n_holdout: number
          rho: number
          updated_at: string
          user_id: string
        }
        Insert: {
          n_holdout?: number
          rho?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          n_holdout?: number
          rho?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      wishlist: {
        Row: {
          bottle_id: string
          created_at: string
          id: string
          source_context: string | null
          user_id: string
        }
        Insert: {
          bottle_id: string
          created_at?: string
          id?: string
          source_context?: string | null
          user_id: string
        }
        Update: {
          bottle_id?: string
          created_at?: string
          id?: string
          source_context?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wishlist_bottle_id_fkey"
            columns: ["bottle_id"]
            isOneToOne: false
            referencedRelation: "bottles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      prediction_axis_bias: {
        Row: {
          axis: string | null
          error_axis_corr: number | null
          fp_pipeline: string | null
          mean_axis_delta: number | null
          mean_error_when_higher: number | null
          mean_error_when_lower: number | null
          mean_signed_error: number | null
          min_n_for_inference: number | null
          n: number | null
          n_higher: number | null
          n_lower: number | null
          n_style_was_wrong: number | null
          n_taste_was_wrong: number | null
          user_id: string | null
          wine_type: string | null
        }
        Relationships: []
      }
      prediction_baseline_comparison: {
        Row: {
          baseline_mae: number | null
          baseline_prediction: number | null
          mae_improvement: number | null
          model_mae: number | null
          n_scored: number | null
          skill_score: number | null
          user_id: string | null
          wine_type: string | null
        }
        Relationships: []
      }
      prediction_error_summary: {
        Row: {
          first_logged_at: string | null
          fp_pipeline: string | null
          last_logged_at: string | null
          mae: number | null
          mae_rank_1: number | null
          mae_rank_rest: number | null
          mean_signed_error: number | null
          n_logged: number | null
          n_scored: number | null
          n_unscored: number | null
          palate_version: number | null
          sd_error: number | null
          user_id: string | null
          wine_type: string | null
          within_half_star: number | null
          within_one_star: number | null
          worst_miss: number | null
        }
        Relationships: []
      }
      scan_call_hit_rate: {
        Row: {
          call_hit_rate: number | null
          mean_chosen_rank: number | null
          mean_list_size: number | null
          mean_price_vs_call: number | null
          month: string | null
          n_orders_logged: number | null
          n_took_the_call: number | null
          top3_hit_rate: number | null
          user_id: string | null
        }
        Relationships: []
      }
      scan_offer_outcomes: {
        Row: {
          best_predicted_offered: number | null
          mae_on_chosen: number | null
          mean_predicted_all: number | null
          mean_predicted_chosen: number | null
          mean_predicted_not_chosen: number | null
          n_offered: number | null
          n_predicted: number | null
          n_rated: number | null
          scan_id: string | null
          scanned_at: string | null
          user_id: string | null
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
    }
    Functions: {
      admin_auth_audit_entries: {
        Args: { p_limit?: number; p_since?: string }
        Returns: {
          action: string
          created_at: string
          error: string
          id: string
          ip_address: string
          method: string
          path: string
          payload: Json
          provider: string
          status: string
        }[]
      }
      admin_capture_summary: {
        Args: { p_min_obs?: number }
        Returns: {
          possible_duplicates: number
          restaurants_with_min_obs: number
          scans_this_week: number
          total_listings: number
          total_price_obs: number
          total_restaurants: number
        }[]
      }
      admin_consensus_gate_status: {
        Args: never
        Returns: {
          distinct_users: number
          global_pass: boolean
          min_ratings: number
          min_users: number
          total_ratings: number
        }[]
      }
      admin_consensus_scan: {
        Args: {
          p_min_palates?: number
          p_min_raters?: number
          p_sign_consistency?: number
          p_step?: number
          p_surprise?: number
          p_write?: boolean
        }
        Returns: {
          axes_evaluated: number
          bottles_eligible: number
          global_pass: boolean
          observations_written: number
          run_id: string
        }[]
      }
      admin_consensus_validate: {
        Args: { p_observation_id: string }
        Returns: {
          axis: string
          bottle_id: string
          err_prior: number
          err_shadow: number
          n_test: number
          observation_id: string
          promoted: boolean
          reason: string
        }[]
      }
      admin_daily_active_users: {
        Args: { p_days?: number }
        Returns: {
          day: string
          users: number
        }[]
      }
      admin_fp_drift: {
        Args: never
        Returns: {
          drift_max: number
          drift_p95: number
          drift_sum: number
          n_bottles: number
          n_moved: number
        }[]
      }
      admin_fp_prior_stats: {
        Args: never
        Returns: {
          n_bottles: number
          n_flat: number
          n_llm_calibrated: number
          tau0_max: number
          tau0_median: number
          tau0_min: number
          tau0_p25: number
          tau0_p75: number
        }[]
      }
      admin_fp_recompute_all: {
        Args: never
        Returns: {
          bottles_touched: number
        }[]
      }
      admin_fp_recompute_bottle: {
        Args: { p_bottle_id: string }
        Returns: {
          axis: string
          moved: boolean
          new_value: number
          old_value: number
          sum_lambda: number
        }[]
      }
      admin_group_count: {
        Args: { p_column: string; p_table: string }
        Returns: {
          n: number
          value: string
        }[]
      }
      admin_reliability_recompute: {
        Args: never
        Returns: {
          users_touched: number
        }[]
      }
      admin_restaurant_coverage: {
        Args: { p_limit?: number }
        Returns: {
          city: string
          first_seen: string
          id: string
          last_seen: string
          listings: number
          name: string
          possible_duplicate: boolean
          price_obs: number
          venue_raw_text_last: string
        }[]
      }
      admin_somm_code_generate: {
        Args: { p_admin_id: string; p_note?: string }
        Returns: {
          code: string
        }[]
      }
      admin_somm_code_revoke: {
        Args: { p_admin_id: string; p_code: string }
        Returns: boolean
      }
      admin_somm_codes_list: {
        Args: never
        Returns: {
          code: string
          created_at: string
          note: string
          revoked_at: string
          status: string
          used_at: string
          used_by: string
          used_by_display_name: string
          used_by_email: string
          used_by_username: string
        }[]
      }
      admin_table_columns: {
        Args: { p_table: string }
        Returns: {
          column_name: string
          data_type: string
          is_nullable: string
        }[]
      }
      admin_table_list: {
        Args: never
        Returns: {
          table_name: string
        }[]
      }
      admin_usage_summary: {
        Args: never
        Returns: {
          active_24h: number
          active_30d: number
          active_7d: number
          median_ratings_per_user: number
          new_this_week: number
          total_users: number
        }[]
      }
      admin_user_list: {
        Args: { p_limit?: number; p_offset?: number }
        Returns: {
          created_at: string
          display_name: string
          id: string
          last_seen_at: string
          ratings_count: number
          scans_count: number
          username: string
          wishlist_count: number
        }[]
      }
      admin_user_list_with_email: {
        Args: { p_admin_id: string; p_limit?: number; p_offset?: number }
        Returns: {
          created_at: string
          display_name: string
          email: string
          id: string
          last_seen_at: string
          ratings_count: number
          scans_count: number
          username: string
          wishlist_count: number
        }[]
      }
      are_friends: { Args: { _a: string; _b: string }; Returns: boolean }
      ct_eq: { Args: { a: string; b: string }; Returns: boolean }
      follow_user: {
        Args: { p_followee: string }
        Returns: {
          follow_id: string
          status: string
        }[]
      }
      get_invite: {
        Args: { p_token: string }
        Returns: {
          inviter_avatar_url: string
          inviter_display_name: string
          inviter_id: string
          inviter_palate_code_red: string
          inviter_palate_code_white: string
          inviter_username: string
          kind: string
          redeemed: boolean
          scan_share_token: string
          scan_venue: string
          token: string
        }[]
      }
      get_public_profile: {
        Args: { p_username: string }
        Returns: {
          avatar_url: string
          bio: string
          created_at: string
          display_name: string
          establishment: string
          follower_count: number
          following_count: number
          id: string
          is_own: boolean
          n_rated: number
          palate_code_red: string
          palate_code_white: string
          somm_role: string
          somm_status: string
          username: string
          viewer_follow_status: string
          visibility: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_same_establishment_verified_somm: {
        Args: { _establishment: string; _user_id: string }
        Returns: boolean
      }
      load_shared_scan: { Args: { p_token: string }; Returns: Json }
      mark_scan_batch_done: {
        Args: { p_batch_index: number; p_scan_id: string }
        Returns: undefined
      }
      mark_scan_batch_failed: {
        Args: { p_batch_index: number; p_scan_id: string }
        Returns: undefined
      }
      redeem_invite: {
        Args: { p_token: string }
        Returns: {
          inviter_id: string
          kind: string
          scan_share_token: string
        }[]
      }
      redeem_somm_code: {
        Args: { p_code: string; p_establishment?: string; p_role?: string }
        Returns: {
          somm_status: string
          verified_at: string
        }[]
      }
      resolve_username_to_id: { Args: { p_username: string }; Returns: string }
      respond_follow: {
        Args: { p_accept: boolean; p_follow_id: string }
        Returns: undefined
      }
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
          p_axis_deltas?: Json
          p_bandwidth?: number
          p_bottle_id: string
          p_n_rated?: number
          p_neighbor_support?: number
          p_null_reason?: string
          p_omega?: Json
          p_predicted?: number
          p_stars: number
          p_tier: string
        }
        Returns: {
          benchmark_id: string
          delta: number
          outcome_id: string
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
        Args: {
          p_axis_deltas?: Json
          p_bandwidth?: number
          p_bottle_id: string
          p_n_rated?: number
          p_neighbor_support?: number
          p_null_reason?: string
          p_omega?: Json
          p_predicted?: number
          p_predicted_rank?: number
          p_scan_id?: string
          p_scan_wine_id?: string
          p_source?: string
          p_stars: number
        }
        Returns: {
          delta: number
          demoted_tier: string
          outcome_id: string
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
          fingerprint_attempts: number
          fp_acid: number
          fp_acid_prior: number
          fp_body: number
          fp_body_prior: number
          fp_dispute_count: number
          fp_fresh: number
          fp_fresh_prior: number
          fp_fruit_dark: number
          fp_fruit_dark_prior: number
          fp_harmonized_at: string | null
          fp_job_id: string | null
          fp_model: string
          fp_oak: number
          fp_oak_prior: number
          fp_pipeline: string
          fp_prior_precision: number
          fp_prompt_hash: string
          fp_ripe: number
          fp_ripe_prior: number
          fp_savory: number
          fp_savory_prior: number
          fp_scored_at: string
          fp_tannin: number
          fp_tannin_prior: number
          fp_vec: string | null
          grape: string | null
          id: string
          last_attempt_at: string | null
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
      set_miss_attribution: {
        Args: { p_attribution: string; p_outcome_id: string }
        Returns: boolean
      }
      somm_grant_claim: {
        Args: { p_code: string }
        Returns: {
          display_name: string
          expires_at: string
          grant_id: string
          guest_id: string
          quiz_answers: Json
          username: string
        }[]
      }
      somm_grant_generate: {
        Args: never
        Returns: {
          code: string
          expires_at: string
          grant_id: string
        }[]
      }
      somm_load_guest_scoring_bundle: {
        Args: { p_grant_id: string; p_guest_id: string }
        Returns: {
          bottle_id: string
          canon: boolean
          fp_acid: number
          fp_body: number
          fp_fresh: number
          fp_fruit_dark: number
          fp_oak: number
          fp_ripe: number
          fp_savory: number
          fp_tannin: number
          name: string
          nemesis: boolean
          producer: string
          region: string
          stars: number
          type: string
          vintage: number
        }[]
      }
      submit_somm_observation: {
        Args: {
          p_axis: string
          p_bottle_id: string
          p_observed_value: number
          p_rationale?: string
        }
        Returns: {
          observation_id: string
          precision_out: number
          reliability: number
        }[]
      }
      unfollow_user: { Args: { p_followee: string }; Returns: undefined }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
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
    Enums: {
      app_role: ["admin", "moderator", "user"],
    },
  },
} as const
