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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      app_settings: {
        Row: {
          key: string
          value: string
        }
        Insert: {
          key: string
          value: string
        }
        Update: {
          key?: string
          value?: string
        }
        Relationships: []
      }
      banners: {
        Row: {
          alt_text: string
          created_at: string
          id: string
          image_path: string
          is_active: boolean
          sort_order: number
        }
        Insert: {
          alt_text?: string
          created_at?: string
          id?: string
          image_path: string
          is_active?: boolean
          sort_order?: number
        }
        Update: {
          alt_text?: string
          created_at?: string
          id?: string
          image_path?: string
          is_active?: boolean
          sort_order?: number
        }
        Relationships: []
      }
      broadcasts: {
        Row: {
          body: string
          created_at: string
          id: string
          title: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          title: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          title?: string
        }
        Relationships: []
      }
      categories: {
        Row: {
          emoji: string
          id: string
          image_url: string | null
          name: string
          sort_order: number
        }
        Insert: {
          emoji?: string
          id?: string
          image_url?: string | null
          name: string
          sort_order?: number
        }
        Update: {
          emoji?: string
          id?: string
          image_url?: string | null
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      orders: {
        Row: {
          accepted_at: string | null
          cancellation_fee: number
          cancelled_at: string | null
          cart_items: Json
          created_at: string
          delivery_address: string | null
          delivery_date: string | null
          delivery_fee: number
          delivery_otp: string | null
          delivery_type: string
          id: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          phone_number: string | null
          refund_proof_url: string | null
          refund_status: string
          refunded_at: string | null
          status: Database["public"]["Enums"]["order_status"]
          student_id: string
          subtotal: number
          total: number
          updated_at: string
          utr_number: string | null
        }
        Insert: {
          accepted_at?: string | null
          cancellation_fee?: number
          cancelled_at?: string | null
          cart_items: Json
          created_at?: string
          delivery_address?: string | null
          delivery_date?: string | null
          delivery_fee: number
          delivery_otp?: string | null
          delivery_type?: string
          id?: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          phone_number?: string | null
          refund_proof_url?: string | null
          refund_status?: string
          refunded_at?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          student_id: string
          subtotal?: number
          total?: number
          updated_at?: string
          utr_number?: string | null
        }
        Update: {
          accepted_at?: string | null
          cancellation_fee?: number
          cancelled_at?: string | null
          cart_items?: Json
          created_at?: string
          delivery_address?: string | null
          delivery_date?: string | null
          delivery_fee?: number
          delivery_otp?: string | null
          delivery_type?: string
          id?: string
          payment_method?: Database["public"]["Enums"]["payment_method"]
          phone_number?: string | null
          refund_proof_url?: string | null
          refund_status?: string
          refunded_at?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          student_id?: string
          subtotal?: number
          total?: number
          updated_at?: string
          utr_number?: string | null
        }
        Relationships: []
      }
      products: {
        Row: {
          actual_price: number | null
          badge_text: string | null
          category_id: string | null
          created_at: string
          delivery_types: string[]
          description: string | null
          id: string
          image_path: string | null
          image_url: string | null
          in_stock: boolean
          name: string
          price: number
          specs_text: string | null
          stock_quantity: number
          tagline: string | null
        }
        Insert: {
          actual_price?: number | null
          badge_text?: string | null
          category_id?: string | null
          created_at?: string
          delivery_types?: string[]
          description?: string | null
          id?: string
          image_path?: string | null
          image_url?: string | null
          in_stock?: boolean
          name: string
          price: number
          specs_text?: string | null
          stock_quantity?: number
          tagline?: string | null
        }
        Update: {
          actual_price?: number | null
          badge_text?: string | null
          category_id?: string | null
          created_at?: string
          delivery_types?: string[]
          description?: string | null
          id?: string
          image_path?: string | null
          image_url?: string | null
          in_stock?: boolean
          name?: string
          price?: number
          specs_text?: string | null
          stock_quantity?: number
          tagline?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          ban_status: string | null
          created_at: string
          fcm_token: string | null
          full_name: string | null
          hostel_details: string | null
          id: string
          phone_number: string | null
          room_number: string | null
        }
        Insert: {
          ban_status?: string | null
          created_at?: string
          fcm_token?: string | null
          full_name?: string | null
          hostel_details?: string | null
          id: string
          phone_number?: string | null
          room_number?: string | null
        }
        Update: {
          ban_status?: string | null
          created_at?: string
          fcm_token?: string | null
          full_name?: string | null
          hostel_details?: string | null
          id?: string
          phone_number?: string | null
          room_number?: string | null
        }
        Relationships: []
      }
      push_devices: {
        Row: {
          device_id: string
          project_id: string
          token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          device_id: string
          project_id: string
          token: string
          updated_at?: string
          user_id: string
        }
        Update: {
          device_id?: string
          project_id?: string
          token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_devices_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      suggestions: {
        Row: {
          created_at: string
          id: string
          suggestion_text: string
          user_id: string
          user_name: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          suggestion_text: string
          user_id: string
          user_name?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          suggestion_text?: string
          user_id?: string
          user_name?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      deliver_order_with_otp: {
        Args: { _delivery_otp: string; _order_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      register_push_device: {
        Args: { _device_id: string; _project_id: string; _token: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "student" | "vendor" | "admin"
      order_status:
        | "pending"
        | "payment_review"
        | "accepted"
        | "out_for_delivery"
        | "delivered"
        | "cancelled"
      payment_method: "UPI" | "COD"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      app_role: ["student", "vendor", "admin"],
      order_status: [
        "pending",
        "payment_review",
        "accepted",
        "out_for_delivery",
        "delivered",
        "cancelled",
      ],
      payment_method: ["UPI", "COD"],
    },
  },
} as const
