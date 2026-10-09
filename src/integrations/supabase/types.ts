export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      inventory_items: {
        Row: {
          id: string;
          name: string;
          unit: string;
          initial_stock: number;
          added_stock: number;
          total_used: number;
          current_stock: number;
          low_stock_threshold: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          unit: string;
          initial_stock?: number;
          added_stock?: number;
          total_used?: number;
          current_stock?: number;
          low_stock_threshold?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          unit?: string;
          initial_stock?: number;
          added_stock?: number;
          total_used?: number;
          current_stock?: number;
          low_stock_threshold?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      inventory_movements: {
        Row: {
          id: string;
          item_id: string;
          type: string;
          qty: number;
          reference: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          item_id: string;
          type: string;
          qty: number;
          reference?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          item_id?: string;
          type?: string;
          qty?: number;
          reference?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "inventory_movements_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "inventory_items";
            referencedColumns: ["id"];
          },
        ];
      };
      categories: {
        Row: {
          category_type: "Finished Good" | "recipe_based";
          created_at: string;
          id: string;
          name: string;
        };
        Insert: {
          category_type: "Finished Good" | "recipe_based";
          created_at?: string;
          id?: string;
          name: string;
        };
        Update: {
          category_type?: "Finished Good" | "recipe_based";
          created_at?: string;
          id?: string;
          name?: string;
        };
        Relationships: [];
      };
      inventory_transactions: {
        Row: {
          created_at: string;
          created_by: string | null;
          id: string;
          product_id: string;
          quantity: number;
          reference: string | null;
          transaction_type: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          product_id: string;
          quantity: number;
          reference?: string | null;
          transaction_type: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          product_id?: string;
          quantity?: number;
          reference?: string | null;
          transaction_type?: string;
        };
        Relationships: [
          {
            foreignKeyName: "inventory_transactions_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      product_recipes: {
        Row: {
          id: string;
          product_id: string;
          item_id: string;
          quantity_required: number;
        };
        Insert: {
          id?: string;
          product_id: string;
          item_id: string;
          quantity_required: number;
        };
        Update: {
          id?: string;
          product_id?: string;
          item_id?: string;
          quantity_required?: number;
        };
        Relationships: [];
      };
      product_variants: {
        Row: {
          id: string;
          product_id: string;
          name: string;
          price: number;
          recipes: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          product_id: string;
          name: string;
          price: number;
          recipes?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          product_id?: string;
          name?: string;
          price?: number;
          recipes?: Json;
          created_at?: string;
        };
        Relationships: [];
      };
      reservations: {
        Row: {
          created_at: string;
          contact_number: string;
          customer_name: string;
          customer_photo_path: string;
          id: string;
          notes: string;
          pickup_date: string;
          pickup_time: string;
          reservation_number: string;
          status: "PENDING" | "COMPLETED";
          total_amount: number;
        };
        Insert: {
          created_at?: string;
          contact_number: string;
          customer_name: string;
          customer_photo_path: string;
          id?: string;
          notes?: string;
          pickup_date: string;
          pickup_time: string;
          reservation_number?: string;
          status?: "PENDING" | "COMPLETED";
          total_amount: number;
        };
        Update: {
          created_at?: string;
          contact_number?: string;
          customer_name?: string;
          customer_photo_path?: string;
          id?: string;
          notes?: string;
          pickup_date?: string;
          pickup_time?: string;
          reservation_number?: string;
          status?: "PENDING" | "COMPLETED";
          total_amount?: number;
        };
        Relationships: [];
      };
      reservation_items: {
        Row: {
          created_at: string;
          id: string;
          product_id: string | null;
          product_name: string;
          product_variant_id: string | null;
          quantity: number;
          reservation_id: string;
          subtotal: number;
          unit_price: number;
          variant_name: string | null;
        };
        Insert: {
          created_at?: string;
          id?: string;
          product_id?: string | null;
          product_name: string;
          product_variant_id?: string | null;
          quantity: number;
          reservation_id: string;
          subtotal: number;
          unit_price: number;
          variant_name?: string | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          product_id?: string | null;
          product_name?: string;
          product_variant_id?: string | null;
          quantity?: number;
          reservation_id?: string;
          subtotal?: number;
          unit_price?: number;
          variant_name?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "reservation_items_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reservation_items_product_variant_id_fkey";
            columns: ["product_variant_id"];
            isOneToOne: false;
            referencedRelation: "product_variants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reservation_items_reservation_id_fkey";
            columns: ["reservation_id"];
            isOneToOne: false;
            referencedRelation: "reservations";
            referencedColumns: ["id"];
          },
        ];
      };
      reservation_staff_access: {
        Row: {
          granted_at: string;
          granted_by: string | null;
          user_id: string;
        };
        Insert: {
          granted_at?: string;
          granted_by?: string | null;
          user_id: string;
        };
        Update: {
          granted_at?: string;
          granted_by?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      products: {
        Row: {
          category_id: string | null;
          cost: number;
          created_at: string;
          description: string | null;
          id: string;
          image_url: string | null;
          is_active: boolean;
          low_stock_threshold: number;
          name: string;
          price: number;
          stock_quantity: number;
          updated_at: string;
        };
        Insert: {
          category_id?: string | null;
          cost?: number;
          created_at?: string;
          description?: string | null;
          id?: string;
          image_url?: string | null;
          is_active?: boolean;
          low_stock_threshold?: number;
          name: string;
          price?: number;
          stock_quantity?: number;
          updated_at?: string;
        };
        Update: {
          category_id?: string | null;
          cost?: number;
          created_at?: string;
          description?: string | null;
          id?: string;
          image_url?: string | null;
          is_active?: boolean;
          low_stock_threshold?: number;
          name?: string;
          price?: number;
          stock_quantity?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          created_at: string;
          email: string;
          full_name: string;
          id: string;
          username: string | null;
        };
        Insert: {
          created_at?: string;
          email?: string;
          full_name?: string;
          id: string;
          username?: string | null;
        };
        Update: {
          created_at?: string;
          email?: string;
          full_name?: string;
          id?: string;
          username?: string | null;
        };
        Relationships: [];
      };
      sale_items: {
        Row: {
          created_at: string;
          id: string;
          product_id: string;
          product_variant_id: string | null;
          quantity: number;
          sale_id: string;
          unit_price: number;
          variant_name: string | null;
        };
        Insert: {
          created_at?: string;
          id?: string;
          product_id: string;
          product_variant_id?: string | null;
          quantity: number;
          sale_id: string;
          unit_price: number;
          variant_name?: string | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          product_id?: string;
          product_variant_id?: string | null;
          quantity?: number;
          sale_id?: string;
          unit_price?: number;
          variant_name?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "sale_items_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sale_items_product_variant_id_fkey";
            columns: ["product_variant_id"];
            isOneToOne: false;
            referencedRelation: "product_variants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sale_items_sale_id_fkey";
            columns: ["sale_id"];
            isOneToOne: false;
            referencedRelation: "sales";
            referencedColumns: ["id"];
          },
        ];
      };
      sales: {
        Row: {
          id: string;
          reservation_id: string | null;
          receipt_number: string;
          sale_date: string;
          subtotal: number;
          tax: number;
          total_amount: number;
          user_id: string;
        };
        Insert: {
          id?: string;
          reservation_id?: string | null;
          receipt_number: string;
          sale_date?: string;
          subtotal?: number;
          tax?: number;
          total_amount?: number;
          user_id: string;
        };
        Update: {
          id?: string;
          reservation_id?: string | null;
          receipt_number?: string;
          sale_date?: string;
          subtotal?: number;
          tax?: number;
          total_amount?: number;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "sales_reservation_id_fkey";
            columns: ["reservation_id"];
            isOneToOne: true;
            referencedRelation: "reservations";
            referencedColumns: ["id"];
          },
        ];
      };
      user_roles: {
        Row: {
          created_at: string;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      process_pos_checkout: {
        Args: { p_receipt_id: string; p_items: Json };
        Returns: Json;
      };
      process_sale_checkout: {
        Args: {
          p_items: Json;
          p_receipt_number: string | null;
          p_reservation_id: string | null;
          p_user_id: string;
        };
        Returns: Json;
      };
      admin_delete_user: {
        Args: { target_user_id: string };
        Returns: undefined;
      };
      claim_first_admin: {
        Args: Record<PropertyKey, never>;
        Returns: undefined;
      };
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
      create_customer_reservation: {
        Args: {
          p_contact_number: string;
          p_customer_name: string;
          p_customer_photo_path: string;
          p_items: Json;
          p_notes: string;
          p_pickup_date: string;
          p_pickup_time: string;
        };
        Returns: Json;
      };
      has_reservation_staff_access: {
        Args: Record<PropertyKey, never>;
        Returns: boolean;
      };
      set_reservation_staff_access: {
        Args: {
          p_allowed: boolean;
          p_user_id: string;
        };
        Returns: undefined;
      };
    };
    Enums: {
      app_role: "admin" | "cashier";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "cashier"],
    },
  },
} as const;
