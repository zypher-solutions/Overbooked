
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "add_ons": {
                  Row: {
                    "amount": number,"basis": string,"created_at": string,"id": string,"is_active": boolean,"name": string,"shop_id": string,"template_keys": (string)[]
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"basis": string,"created_at"?: string,"id"?: string,"is_active"?: boolean,"name": string,"shop_id": string,"template_keys"?: (string)[]
                  }
                  Update: {
                    "amount"?: number,"basis"?: string,"created_at"?: string,"id"?: string,"is_active"?: boolean,"name"?: string,"shop_id"?: string,"template_keys"?: (string)[]
                  }
                  Relationships: [
                    {
      foreignKeyName: "add_ons_shop_id_fkey"
      columns: ["shop_id"]
isOneToOne: false
      referencedRelation: "shops"
      referencedColumns: ["id"]
    }
                  ]
                },"appointments": {
                  Row: {
                    "branch_id": string,"created_at": string,"created_by": string | null,"customer_id": string,"id": string,"notes": string | null,"rental_id": string | null,"scheduled_at": string,"shop_id": string,"status": string,"type": string
                  }
                  ComputedFields: never
                  Insert: {
                    "branch_id": string,"created_at"?: string,"created_by"?: string | null,"customer_id": string,"id"?: string,"notes"?: string | null,"rental_id"?: string | null,"scheduled_at": string,"shop_id": string,"status"?: string,"type": string
                  }
                  Update: {
                    "branch_id"?: string,"created_at"?: string,"created_by"?: string | null,"customer_id"?: string,"id"?: string,"notes"?: string | null,"rental_id"?: string | null,"scheduled_at"?: string,"shop_id"?: string,"status"?: string,"type"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "appointments_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "appointments_shop_branch_fkey"
      columns: ["shop_id","branch_id"]
isOneToOne: false
      referencedRelation: "branches"
      referencedColumns: ["shop_id","id"]
    },{
      foreignKeyName: "appointments_shop_customer_fkey"
      columns: ["shop_id","customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["shop_id","id"]
    },{
      foreignKeyName: "appointments_shop_id_fkey"
      columns: ["shop_id"]
isOneToOne: false
      referencedRelation: "shops"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "appointments_shop_rental_fkey"
      columns: ["shop_id","rental_id"]
isOneToOne: false
      referencedRelation: "rentals"
      referencedColumns: ["shop_id","id"]
    }
                  ]
                },"audit_log": {
                  Row: {
                    "action": string,"id": number,"new_data": Json | null,"old_data": Json | null,"performed_at": string,"performed_by": string | null,"reason": string | null,"record_id": string | null,"shop_id": string | null,"table_name": string,"via": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"id"?: never,"new_data"?: Json | null,"old_data"?: Json | null,"performed_at"?: string,"performed_by"?: string | null,"reason"?: string | null,"record_id"?: string | null,"shop_id"?: string | null,"table_name": string,"via": string
                  }
                  Update: {
                    "action"?: string,"id"?: never,"new_data"?: Json | null,"old_data"?: Json | null,"performed_at"?: string,"performed_by"?: string | null,"reason"?: string | null,"record_id"?: string | null,"shop_id"?: string | null,"table_name"?: string,"via"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "audit_log_shop_id_fkey"
      columns: ["shop_id"]
isOneToOne: false
      referencedRelation: "shops"
      referencedColumns: ["id"]
    }
                  ]
                },"branches": {
                  Row: {
                    "address": string | null,"created_at": string,"email": string | null,"id": string,"is_active": boolean,"name": string,"phone": string | null,"shop_id": string,"slug": string
                  }
                  ComputedFields: never
                  Insert: {
                    "address"?: string | null,"created_at"?: string,"email"?: string | null,"id"?: string,"is_active"?: boolean,"name": string,"phone"?: string | null,"shop_id": string,"slug": string
                  }
                  Update: {
                    "address"?: string | null,"created_at"?: string,"email"?: string | null,"id"?: string,"is_active"?: boolean,"name"?: string,"phone"?: string | null,"shop_id"?: string,"slug"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "branches_shop_id_fkey"
      columns: ["shop_id"]
isOneToOne: false
      referencedRelation: "shops"
      referencedColumns: ["id"]
    }
                  ]
                },"business_templates": {
                  Row: {
                    "checks": NonNullable<Json>,"default_add_ons": NonNullable<Json>,"features": NonNullable<Json>,"key": string,"kind": string,"labels": NonNullable<Json>,"measurement_fields": NonNullable<Json>,"name": string,"rate_types": (string)[],"sort": number,"turnaround": string,"unit_fields": NonNullable<Json>,"variation_fields": NonNullable<Json>
                  }
                  ComputedFields: never
                  Insert: {
                    "checks"?: NonNullable<Json>,"default_add_ons"?: NonNullable<Json>,"features"?: NonNullable<Json>,"key": string,"kind": string,"labels"?: NonNullable<Json>,"measurement_fields"?: NonNullable<Json>,"name": string,"rate_types": (string)[],"sort"?: number,"turnaround"?: string,"unit_fields"?: NonNullable<Json>,"variation_fields"?: NonNullable<Json>
                  }
                  Update: {
                    "checks"?: NonNullable<Json>,"default_add_ons"?: NonNullable<Json>,"features"?: NonNullable<Json>,"key"?: string,"kind"?: string,"labels"?: NonNullable<Json>,"measurement_fields"?: NonNullable<Json>,"name"?: string,"rate_types"?: (string)[],"sort"?: number,"turnaround"?: string,"unit_fields"?: NonNullable<Json>,"variation_fields"?: NonNullable<Json>
                  }
                  Relationships: [
                    
                  ]
                },"categories": {
                  Row: {
                    "created_at": string,"id": string,"name": string,"shop_id": string,"sku_prefix": string | null,"template_key": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"name": string,"shop_id": string,"sku_prefix"?: string | null,"template_key": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"name"?: string,"shop_id"?: string,"sku_prefix"?: string | null,"template_key"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "categories_shop_id_fkey"
      columns: ["shop_id"]
isOneToOne: false
      referencedRelation: "shops"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "categories_template_key_fkey"
      columns: ["template_key"]
isOneToOne: false
      referencedRelation: "business_templates"
      referencedColumns: ["key"]
    }
                  ]
                },"customer_measurements": {
                  Row: {
                    "customer_id": string,"id": string,"label": string,"measurements": NonNullable<Json>,"notes": string | null,"shop_id": string,"taken_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "customer_id": string,"id"?: string,"label"?: string,"measurements"?: NonNullable<Json>,"notes"?: string | null,"shop_id": string,"taken_at"?: string
                  }
                  Update: {
                    "customer_id"?: string,"id"?: string,"label"?: string,"measurements"?: NonNullable<Json>,"notes"?: string | null,"shop_id"?: string,"taken_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "customer_measurements_shop_customer_fkey"
      columns: ["shop_id","customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["shop_id","id"]
    },{
      foreignKeyName: "customer_measurements_shop_id_fkey"
      columns: ["shop_id"]
isOneToOne: false
      referencedRelation: "shops"
      referencedColumns: ["id"]
    }
                  ]
                },"customers": {
                  Row: {
                    "address": string | null,"blocked_reason": string | null,"created_at": string,"email": string | null,"full_name": string,"id": string,"id_number": string | null,"id_type": string | null,"is_blocked": boolean,"licence_expiry": string | null,"licence_number": string | null,"notes": string | null,"phone": string,"shop_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "address"?: string | null,"blocked_reason"?: string | null,"created_at"?: string,"email"?: string | null,"full_name": string,"id"?: string,"id_number"?: string | null,"id_type"?: string | null,"is_blocked"?: boolean,"licence_expiry"?: string | null,"licence_number"?: string | null,"notes"?: string | null,"phone": string,"shop_id": string
                  }
                  Update: {
                    "address"?: string | null,"blocked_reason"?: string | null,"created_at"?: string,"email"?: string | null,"full_name"?: string,"id"?: string,"id_number"?: string | null,"id_type"?: string | null,"is_blocked"?: boolean,"licence_expiry"?: string | null,"licence_number"?: string | null,"notes"?: string | null,"phone"?: string,"shop_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "customers_shop_id_fkey"
      columns: ["shop_id"]
isOneToOne: false
      referencedRelation: "shops"
      referencedColumns: ["id"]
    }
                  ]
                },"payments": {
                  Row: {
                    "amount": number,"created_at": string,"id": string,"kind": string,"method": string | null,"note": string | null,"paid_at": string,"recorded_by": string | null,"rental_id": string,"shop_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"created_at"?: string,"id"?: string,"kind": string,"method"?: string | null,"note"?: string | null,"paid_at"?: string,"recorded_by"?: string | null,"rental_id": string,"shop_id": string
                  }
                  Update: {
                    "amount"?: number,"created_at"?: string,"id"?: string,"kind"?: string,"method"?: string | null,"note"?: string | null,"paid_at"?: string,"recorded_by"?: string | null,"rental_id"?: string,"shop_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "payments_recorded_by_fkey"
      columns: ["recorded_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payments_shop_id_fkey"
      columns: ["shop_id"]
isOneToOne: false
      referencedRelation: "shops"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payments_shop_rental_fkey"
      columns: ["shop_id","rental_id"]
isOneToOne: false
      referencedRelation: "rentals"
      referencedColumns: ["shop_id","id"]
    }
                  ]
                },"platform_settings": {
                  Row: {
                    "address": string | null,"auto_pause_after_days": number | null,"bank_details": string | null,"company_name": string,"email": string | null,"gstin": string | null,"id": number,"phone": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "address"?: string | null,"auto_pause_after_days"?: number | null,"bank_details"?: string | null,"company_name"?: string,"email"?: string | null,"gstin"?: string | null,"id"?: number,"phone"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "address"?: string | null,"auto_pause_after_days"?: number | null,"bank_details"?: string | null,"company_name"?: string,"email"?: string | null,"gstin"?: string | null,"id"?: number,"phone"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"product_variations": {
                  Row: {
                    "attributes": NonNullable<Json>,"base_occupancy": number | null,"created_at": string,"id": string,"is_enabled": boolean,"km_included_per_day": number | null,"max_occupancy": number | null,"name": string,"product_id": string,"shop_id": string,"sku": string,"turnaround": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attributes"?: NonNullable<Json>,"base_occupancy"?: number | null,"created_at"?: string,"id"?: string,"is_enabled"?: boolean,"km_included_per_day"?: number | null,"max_occupancy"?: number | null,"name": string,"product_id": string,"shop_id": string,"sku": string,"turnaround"?: string
                  }
                  Update: {
                    "attributes"?: NonNullable<Json>,"base_occupancy"?: number | null,"created_at"?: string,"id"?: string,"is_enabled"?: boolean,"km_included_per_day"?: number | null,"max_occupancy"?: number | null,"name"?: string,"product_id"?: string,"shop_id"?: string,"sku"?: string,"turnaround"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "product_variations_shop_id_fkey"
      columns: ["shop_id"]
isOneToOne: false
      referencedRelation: "shops"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_variations_shop_product_fkey"
      columns: ["shop_id","product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["shop_id","id"]
    }
                  ]
                },"products": {
                  Row: {
                    "category_id": string,"created_at": string,"description": string | null,"id": string,"image_url": string | null,"is_active": boolean,"is_set": boolean,"name": string,"purchase_price": number,"replacement_value": number,"shop_id": string,"sku": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "category_id": string,"created_at"?: string,"description"?: string | null,"id"?: string,"image_url"?: string | null,"is_active"?: boolean,"is_set"?: boolean,"name": string,"purchase_price"?: number,"replacement_value"?: number,"shop_id": string,"sku": string,"updated_at"?: string
                  }
                  Update: {
                    "category_id"?: string,"created_at"?: string,"description"?: string | null,"id"?: string,"image_url"?: string | null,"is_active"?: boolean,"is_set"?: boolean,"name"?: string,"purchase_price"?: number,"replacement_value"?: number,"shop_id"?: string,"sku"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "products_shop_category_fkey"
      columns: ["shop_id","category_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["shop_id","id"]
    },{
      foreignKeyName: "products_shop_id_fkey"
      columns: ["shop_id"]
isOneToOne: false
      referencedRelation: "shops"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "active_shop_id": string | null,"avatar_url": string | null,"branch_id": string | null,"created_at": string,"full_name": string,"id": string,"is_active": boolean,"role": string,"shop_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "active_shop_id"?: string | null,"avatar_url"?: string | null,"branch_id"?: string | null,"created_at"?: string,"full_name": string,"id": string,"is_active"?: boolean,"role"?: string,"shop_id"?: string | null
                  }
                  Update: {
                    "active_shop_id"?: string | null,"avatar_url"?: string | null,"branch_id"?: string | null,"created_at"?: string,"full_name"?: string,"id"?: string,"is_active"?: boolean,"role"?: string,"shop_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "profiles_active_shop_id_fkey"
      columns: ["active_shop_id"]
isOneToOne: false
      referencedRelation: "shops"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "profiles_shop_branch_fkey"
      columns: ["shop_id","branch_id"]
isOneToOne: false
      referencedRelation: "branches"
      referencedColumns: ["shop_id","id"]
    },{
      foreignKeyName: "profiles_shop_id_fkey"
      columns: ["shop_id"]
isOneToOne: false
      referencedRelation: "shops"
      referencedColumns: ["id"]
    }
                  ]
                },"rental_add_ons": {
                  Row: {
                    "add_on_id": string,"amount": number,"basis": string,"id": string,"name": string,"quantity": number,"rental_id": string,"shop_id": string,"unit_amount": number
                  }
                  ComputedFields: never
                  Insert: {
                    "add_on_id": string,"amount": number,"basis": string,"id"?: string,"name": string,"quantity": number,"rental_id": string,"shop_id": string,"unit_amount": number
                  }
                  Update: {
                    "add_on_id"?: string,"amount"?: number,"basis"?: string,"id"?: string,"name"?: string,"quantity"?: number,"rental_id"?: string,"shop_id"?: string,"unit_amount"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "rental_add_ons_shop_add_on_fkey"
      columns: ["shop_id","add_on_id"]
isOneToOne: false
      referencedRelation: "add_ons"
      referencedColumns: ["shop_id","id"]
    },{
      foreignKeyName: "rental_add_ons_shop_id_fkey"
      columns: ["shop_id"]
isOneToOne: false
      referencedRelation: "shops"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "rental_add_ons_shop_rental_fkey"
      columns: ["shop_id","rental_id"]
isOneToOne: false
      referencedRelation: "rentals"
      referencedColumns: ["shop_id","id"]
    }
                  ]
                },"rental_charges": {
                  Row: {
                    "amount": number,"created_at": string,"created_by": string | null,"id": string,"note": string | null,"rental_id": string,"shop_id": string,"type": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"created_at"?: string,"created_by"?: string | null,"id"?: string,"note"?: string | null,"rental_id": string,"shop_id": string,"type": string
                  }
                  Update: {
                    "amount"?: number,"created_at"?: string,"created_by"?: string | null,"id"?: string,"note"?: string | null,"rental_id"?: string,"shop_id"?: string,"type"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "rental_charges_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "rental_charges_shop_id_fkey"
      columns: ["shop_id"]
isOneToOne: false
      referencedRelation: "shops"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "rental_charges_shop_rental_fkey"
      columns: ["shop_id","rental_id"]
isOneToOne: false
      referencedRelation: "rentals"
      referencedColumns: ["shop_id","id"]
    }
                  ]
                },"rental_checks": {
                  Row: {
                    "checked_at": string,"checked_by": string | null,"condition": string | null,"fuel_level": number | null,"id": string,"notes": string | null,"odometer": number | null,"phase": string,"photo_paths": (string)[],"rental_id": string,"shop_id": string,"unit_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "checked_at"?: string,"checked_by"?: string | null,"condition"?: string | null,"fuel_level"?: number | null,"id"?: string,"notes"?: string | null,"odometer"?: number | null,"phase": string,"photo_paths"?: (string)[],"rental_id": string,"shop_id": string,"unit_id": string
                  }
                  Update: {
                    "checked_at"?: string,"checked_by"?: string | null,"condition"?: string | null,"fuel_level"?: number | null,"id"?: string,"notes"?: string | null,"odometer"?: number | null,"phase"?: string,"photo_paths"?: (string)[],"rental_id"?: string,"shop_id"?: string,"unit_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "rental_checks_checked_by_fkey"
      columns: ["checked_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "rental_checks_shop_id_fkey"
      columns: ["shop_id"]
isOneToOne: false
      referencedRelation: "shops"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "rental_checks_shop_rental_fkey"
      columns: ["shop_id","rental_id"]
isOneToOne: false
      referencedRelation: "rentals"
      referencedColumns: ["shop_id","id"]
    },{
      foreignKeyName: "rental_checks_shop_unit_fkey"
      columns: ["shop_id","unit_id"]
isOneToOne: false
      referencedRelation: "units"
      referencedColumns: ["shop_id","id"]
    }
                  ]
                },"rental_lines": {
                  Row: {
                    "amount": number,"created_at": string,"description": string,"id": string,"image_url": string | null,"is_override": boolean,"kind": string,"product_id": string,"qty": number,"rate": number,"rate_type": string,"rental_id": string,"set_product_id": string | null,"shop_id": string,"sku": string,"time_units": number,"variation_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"created_at"?: string,"description": string,"id"?: string,"image_url"?: string | null,"is_override"?: boolean,"kind": string,"product_id": string,"qty": number,"rate": number,"rate_type": string,"rental_id": string,"set_product_id"?: string | null,"shop_id": string,"sku": string,"time_units": number,"variation_id": string
                  }
                  Update: {
                    "amount"?: number,"created_at"?: string,"description"?: string,"id"?: string,"image_url"?: string | null,"is_override"?: boolean,"kind"?: string,"product_id"?: string,"qty"?: number,"rate"?: number,"rate_type"?: string,"rental_id"?: string,"set_product_id"?: string | null,"shop_id"?: string,"sku"?: string,"time_units"?: number,"variation_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "rental_lines_shop_id_fkey"
      columns: ["shop_id"]
isOneToOne: false
      referencedRelation: "shops"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "rental_lines_shop_product_fkey"
      columns: ["shop_id","product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["shop_id","id"]
    },{
      foreignKeyName: "rental_lines_shop_rental_fkey"
      columns: ["shop_id","rental_id"]
isOneToOne: false
      referencedRelation: "rentals"
      referencedColumns: ["shop_id","id"]
    },{
      foreignKeyName: "rental_lines_shop_set_fkey"
      columns: ["shop_id","set_product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["shop_id","id"]
    },{
      foreignKeyName: "rental_lines_shop_variation_fkey"
      columns: ["shop_id","variation_id"]
isOneToOne: false
      referencedRelation: "product_variations"
      referencedColumns: ["shop_id","id"]
    }
                  ]
                },"rental_reminders": {
                  Row: {
                    "id": string,"kind": string,"rental_id": string,"sent_at": string,"sent_by": string | null,"shop_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "id"?: string,"kind": string,"rental_id": string,"sent_at"?: string,"sent_by"?: string | null,"shop_id": string
                  }
                  Update: {
                    "id"?: string,"kind"?: string,"rental_id"?: string,"sent_at"?: string,"sent_by"?: string | null,"shop_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "rental_reminders_sent_by_fkey"
      columns: ["sent_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "rental_reminders_shop_id_fkey"
      columns: ["shop_id"]
isOneToOne: false
      referencedRelation: "shops"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "rental_reminders_shop_rental_fkey"
      columns: ["shop_id","rental_id"]
isOneToOne: false
      referencedRelation: "rentals"
      referencedColumns: ["shop_id","id"]
    }
                  ]
                },"rentals": {
                  Row: {
                    "actual_end_at": string | null,"actual_start_at": string | null,"add_ons_total": number,"adults": number,"branch_id": string,"cancel_reason": string | null,"cancellation_fee": number,"cancelled_at": string | null,"cancelled_by": string | null,"charges_total": number,"children": number,"cleaning_days": number | null,"created_at": string,"created_by": string | null,"customer_id": string,"deposit_agreed": number,"deposit_applied": number,"deposit_received": number,"deposit_refunded": number,"discount": number,"end_at": string,"id": string,"id_verified_at": string | null,"id_verified_by": string | null,"items_total": number,"notes": string | null,"paid": number,"shop_id": string,"start_at": string,"status": string,"token": string,"total": number | null,"updated_at": string,"whole_property": boolean,"with_driver": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "actual_end_at"?: string | null,"actual_start_at"?: string | null,"add_ons_total"?: number,"adults"?: number,"branch_id": string,"cancel_reason"?: string | null,"cancellation_fee"?: number,"cancelled_at"?: string | null,"cancelled_by"?: string | null,"charges_total"?: number,"children"?: number,"cleaning_days"?: number | null,"created_at"?: string,"created_by"?: string | null,"customer_id": string,"deposit_agreed"?: number,"deposit_applied"?: number,"deposit_received"?: number,"deposit_refunded"?: number,"discount"?: number,"end_at": string,"id"?: string,"id_verified_at"?: string | null,"id_verified_by"?: string | null,"items_total"?: number,"notes"?: string | null,"paid"?: number,"shop_id": string,"start_at": string,"status"?: string,"token": string,"total"?: never,"updated_at"?: string,"whole_property"?: boolean,"with_driver"?: boolean
                  }
                  Update: {
                    "actual_end_at"?: string | null,"actual_start_at"?: string | null,"add_ons_total"?: number,"adults"?: number,"branch_id"?: string,"cancel_reason"?: string | null,"cancellation_fee"?: number,"cancelled_at"?: string | null,"cancelled_by"?: string | null,"charges_total"?: number,"children"?: number,"cleaning_days"?: number | null,"created_at"?: string,"created_by"?: string | null,"customer_id"?: string,"deposit_agreed"?: number,"deposit_applied"?: number,"deposit_received"?: number,"deposit_refunded"?: number,"discount"?: number,"end_at"?: string,"id"?: string,"id_verified_at"?: string | null,"id_verified_by"?: string | null,"items_total"?: number,"notes"?: string | null,"paid"?: number,"shop_id"?: string,"start_at"?: string,"status"?: string,"token"?: string,"total"?: never,"updated_at"?: string,"whole_property"?: boolean,"with_driver"?: boolean
                  }
                  Relationships: [
                    {
      foreignKeyName: "rentals_cancelled_by_fkey"
      columns: ["cancelled_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "rentals_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "rentals_id_verified_by_fkey"
      columns: ["id_verified_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "rentals_shop_branch_fkey"
      columns: ["shop_id","branch_id"]
isOneToOne: false
      referencedRelation: "branches"
      referencedColumns: ["shop_id","id"]
    },{
      foreignKeyName: "rentals_shop_customer_fkey"
      columns: ["shop_id","customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["shop_id","id"]
    },{
      foreignKeyName: "rentals_shop_id_fkey"
      columns: ["shop_id"]
isOneToOne: false
      referencedRelation: "shops"
      referencedColumns: ["id"]
    }
                  ]
                },"set_items": {
                  Row: {
                    "qty": number,"set_product_id": string,"shop_id": string,"variation_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "qty"?: number,"set_product_id": string,"shop_id": string,"variation_id": string
                  }
                  Update: {
                    "qty"?: number,"set_product_id"?: string,"shop_id"?: string,"variation_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "set_items_shop_id_fkey"
      columns: ["shop_id"]
isOneToOne: false
      referencedRelation: "shops"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "set_items_shop_set_fkey"
      columns: ["shop_id","set_product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["shop_id","id"]
    },{
      foreignKeyName: "set_items_shop_variation_fkey"
      columns: ["shop_id","variation_id"]
isOneToOne: false
      referencedRelation: "product_variations"
      referencedColumns: ["shop_id","id"]
    }
                  ]
                },"shop_counters": {
                  Row: {
                    "kind": string,"period": string,"shop_id": string,"value": number
                  }
                  ComputedFields: never
                  Insert: {
                    "kind": string,"period"?: string,"shop_id": string,"value": number
                  }
                  Update: {
                    "kind"?: string,"period"?: string,"shop_id"?: string,"value"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "shop_counters_shop_id_fkey"
      columns: ["shop_id"]
isOneToOne: false
      referencedRelation: "shops"
      referencedColumns: ["id"]
    }
                  ]
                },"shop_payments": {
                  Row: {
                    "amount": number,"created_at": string,"id": string,"kind": string,"method": string,"note": string | null,"paid_on": string,"period_to": string | null,"receipt_no": string,"recorded_by": string | null,"shop_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"created_at"?: string,"id"?: string,"kind"?: string,"method"?: string,"note"?: string | null,"paid_on": string,"period_to"?: string | null,"receipt_no": string,"recorded_by"?: string | null,"shop_id": string
                  }
                  Update: {
                    "amount"?: number,"created_at"?: string,"id"?: string,"kind"?: string,"method"?: string,"note"?: string | null,"paid_on"?: string,"period_to"?: string | null,"receipt_no"?: string,"recorded_by"?: string | null,"shop_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "shop_payments_recorded_by_fkey"
      columns: ["recorded_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "shop_payments_shop_id_fkey"
      columns: ["shop_id"]
isOneToOne: false
      referencedRelation: "shops"
      referencedColumns: ["id"]
    }
                  ]
                },"shops": {
                  Row: {
                    "address": string | null,"business_types": (string)[],"created_at": string,"email": string | null,"gstin": string | null,"id": string,"logo_url": string | null,"monthly_fee": number,"name": string,"notes": string | null,"paid_until": string | null,"phone": string | null,"plan": string,"settings": NonNullable<Json>,"slug": string,"status": string,"timezone": string,"token_prefix": string
                  }
                  ComputedFields: never
                  Insert: {
                    "address"?: string | null,"business_types": (string)[],"created_at"?: string,"email"?: string | null,"gstin"?: string | null,"id"?: string,"logo_url"?: string | null,"monthly_fee"?: number,"name": string,"notes"?: string | null,"paid_until"?: string | null,"phone"?: string | null,"plan"?: string,"settings"?: NonNullable<Json>,"slug": string,"status"?: string,"timezone"?: string,"token_prefix": string
                  }
                  Update: {
                    "address"?: string | null,"business_types"?: (string)[],"created_at"?: string,"email"?: string | null,"gstin"?: string | null,"id"?: string,"logo_url"?: string | null,"monthly_fee"?: number,"name"?: string,"notes"?: string | null,"paid_until"?: string | null,"phone"?: string | null,"plan"?: string,"settings"?: NonNullable<Json>,"slug"?: string,"status"?: string,"timezone"?: string,"token_prefix"?: string
                  }
                  Relationships: [
                    
                  ]
                },"staff_invites": {
                  Row: {
                    "accepted_at": string | null,"branch_id": string | null,"created_at": string,"email": string,"id": string,"invited_by": string | null,"role": string,"shop_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "accepted_at"?: string | null,"branch_id"?: string | null,"created_at"?: string,"email": string,"id"?: string,"invited_by"?: string | null,"role": string,"shop_id": string
                  }
                  Update: {
                    "accepted_at"?: string | null,"branch_id"?: string | null,"created_at"?: string,"email"?: string,"id"?: string,"invited_by"?: string | null,"role"?: string,"shop_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "staff_invites_invited_by_fkey"
      columns: ["invited_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "staff_invites_shop_branch_fkey"
      columns: ["shop_id","branch_id"]
isOneToOne: false
      referencedRelation: "branches"
      referencedColumns: ["shop_id","id"]
    },{
      foreignKeyName: "staff_invites_shop_id_fkey"
      columns: ["shop_id"]
isOneToOne: false
      referencedRelation: "shops"
      referencedColumns: ["id"]
    }
                  ]
                },"unit_reservations": {
                  Row: {
                    "created_at": string,"id": string,"line_id": string,"period": unknown,"rental_id": string,"shop_id": string,"state": string,"unit_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"line_id": string,"period": unknown,"rental_id": string,"shop_id": string,"state"?: string,"unit_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"line_id"?: string,"period"?: unknown,"rental_id"?: string,"shop_id"?: string,"state"?: string,"unit_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "unit_reservations_shop_id_fkey"
      columns: ["shop_id"]
isOneToOne: false
      referencedRelation: "shops"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "unit_reservations_shop_line_fkey"
      columns: ["shop_id","line_id"]
isOneToOne: false
      referencedRelation: "rental_lines"
      referencedColumns: ["shop_id","id"]
    },{
      foreignKeyName: "unit_reservations_shop_rental_fkey"
      columns: ["shop_id","rental_id"]
isOneToOne: false
      referencedRelation: "rentals"
      referencedColumns: ["shop_id","id"]
    },{
      foreignKeyName: "unit_reservations_shop_unit_fkey"
      columns: ["shop_id","unit_id"]
isOneToOne: false
      referencedRelation: "units"
      referencedColumns: ["shop_id","id"]
    }
                  ]
                },"units": {
                  Row: {
                    "attributes": NonNullable<Json>,"branch_id": string,"code": string,"created_at": string,"id": string,"odometer": number | null,"product_id": string,"shop_id": string,"status": string,"status_reason": string | null,"variation_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attributes"?: NonNullable<Json>,"branch_id": string,"code": string,"created_at"?: string,"id"?: string,"odometer"?: number | null,"product_id": string,"shop_id": string,"status"?: string,"status_reason"?: string | null,"variation_id": string
                  }
                  Update: {
                    "attributes"?: NonNullable<Json>,"branch_id"?: string,"code"?: string,"created_at"?: string,"id"?: string,"odometer"?: number | null,"product_id"?: string,"shop_id"?: string,"status"?: string,"status_reason"?: string | null,"variation_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "units_shop_branch_fkey"
      columns: ["shop_id","branch_id"]
isOneToOne: false
      referencedRelation: "branches"
      referencedColumns: ["shop_id","id"]
    },{
      foreignKeyName: "units_shop_id_fkey"
      columns: ["shop_id"]
isOneToOne: false
      referencedRelation: "shops"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "units_shop_product_fkey"
      columns: ["shop_id","product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["shop_id","id"]
    },{
      foreignKeyName: "units_shop_variation_fkey"
      columns: ["shop_id","variation_id"]
isOneToOne: false
      referencedRelation: "product_variations"
      referencedColumns: ["shop_id","id"]
    }
                  ]
                },"variation_rates": {
                  Row: {
                    "amount": number,"rate_type": string,"shop_id": string,"variation_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"rate_type": string,"shop_id": string,"variation_id": string
                  }
                  Update: {
                    "amount"?: number,"rate_type"?: string,"shop_id"?: string,"variation_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "variation_rates_shop_id_fkey"
      columns: ["shop_id"]
isOneToOne: false
      referencedRelation: "shops"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "variation_rates_shop_variation_fkey"
      columns: ["shop_id","variation_id"]
isOneToOne: false
      referencedRelation: "product_variations"
      referencedColumns: ["shop_id","id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "_audit":
{ Args: { "p_id": string,"p_new": Json,"p_old": Json,"p_reason": string,"p_table": string }; Returns: undefined
                           },
"_insert_lines":
{ Args: { "p_branch": string,"p_end": string,"p_prefer"?: (string)[],"p_quote": Json,"p_rental_id": string,"p_start": string }; Returns: undefined
                           },
"_insert_payment":
{ Args: { "p_amount": number,"p_kind": string,"p_method": string,"p_note"?: string,"p_rental_id": string }; Returns: undefined
                           },
"_money":
{ Args: { "p": Json,"p_key": string }; Returns: number
                           },
"_period":
{ Args: { "p_end": string,"p_start": string,"p_variation_id": string }; Returns: unknown
                           } |
{ Args: { "p_cleaning_days": number,"p_end": string,"p_start": string,"p_variation_id": string }; Returns: unknown
                           },
"_quote":
{ Args: { "p": Json }; Returns: Json
                           },
"_require_branch":
{ Args: { "p_branch_id": string }; Returns: undefined
                           },
"_require_correction":
{ Args: { "p_reason": string }; Returns: string
                           },
"_require_role":
{ Args: { "p_allowed"?: (string)[] }; Returns: string
                           },
"_require_zypher":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"_reserve_line":
{ Args: { "p_branch": string,"p_end": string,"p_line": Json,"p_line_id": string,"p_prefer"?: (string)[],"p_rental_id": string,"p_start": string }; Returns: undefined
                           },
"_shop_tz":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"add_rental_charge":
{ Args: { "p_amount": number,"p_note"?: string,"p_rental_id": string,"p_type": string }; Returns: Json
                           },
"admin_delete_charge":
{ Args: { "p_charge_id": string,"p_reason": string }; Returns: Json
                           },
"admin_delete_payment":
{ Args: { "p_payment_id": string,"p_reason": string }; Returns: Json
                           },
"admin_delete_rental":
{ Args: { "p_reason": string,"p_rental_id": string }; Returns: undefined
                           },
"admin_set_discount":
{ Args: { "p_discount": number,"p_reason": string,"p_rental_id": string }; Returns: Json
                           },
"admin_set_line_amount":
{ Args: { "p_amount": number,"p_line_id": string,"p_reason": string }; Returns: Json
                           },
"admin_set_staff_status":
{ Args: { "p_is_active": boolean,"p_role": string,"p_user_id": string }; Returns: undefined
                           },
"admin_update_payment":
{ Args: { "p_amount": number,"p_method": string,"p_payment_id": string,"p_reason": string }; Returns: Json
                           },
"available_units":
{ Args: { "p_branch_id": string,"p_end": string,"p_start": string,"p_variation_id": string }; Returns: {
              "code": string,"unit_id": string
            }[]
                           } |
{ Args: { "p_branch_id": string,"p_cleaning_days": number,"p_end": string,"p_start": string,"p_variation_id": string }; Returns: {
              "code": string,"unit_id": string
            }[]
                           },
"branch_availability":
{ Args: { "p_branch_id": string,"p_end": string,"p_start": string }; Returns: {
              "free": number,"total": number,"variation_id": string
            }[]
                           } |
{ Args: { "p_branch_id": string,"p_cleaning_days": number,"p_end": string,"p_start": string }; Returns: {
              "free": number,"total": number,"variation_id": string
            }[]
                           },
"cancel_rental":
{ Args: { "p_fee"?: number,"p_no_show"?: boolean,"p_reason"?: string,"p_refund_method"?: string,"p_rental_id": string }; Returns: Json
                           },
"complete_rental":
{ Args: { "p"?: Json,"p_rental_id": string }; Returns: Json
                           },
"console_summary":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"create_rental":
{ Args: { "p": Json }; Returns: Json
                           },
"create_shop":
{ Args: { "p": Json }; Returns: string
                           },
"current_shop_id":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"dashboard_summary":
{ Args: { "p_branch_id"?: string,"p_from": string,"p_to": string }; Returns: Json
                           },
"delete_or_deactivate_product":
{ Args: { "p_product_id": string }; Returns: Json
                           },
"extend_rental":
{ Args: { "p_new_end": string,"p_payment"?: Json,"p_rental_id": string }; Returns: Json
                           },
"find_available_units":
{ Args: { "p_branch_id": string,"p_end": string,"p_start": string,"p_variation_id": string }; Returns: {
              "code": string,"unit_id": string
            }[]
                           } |
{ Args: { "p_branch_id": string,"p_cleaning_days": number,"p_end": string,"p_start": string,"p_variation_id": string }; Returns: {
              "code": string,"unit_id": string
            }[]
                           },
"get_my_branch":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"get_my_role":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"get_staff_emails":
{ Args: Record<PropertyKey, never>; Returns: {
              "email": string,"id": string,"last_sign_in_at": string
            }[]
                           },
"import_catalog":
{ Args: { "p": Json }; Returns: Json
                           },
"inventory_status":
{ Args: Record<PropertyKey, never>; Returns: {
              "available_now": number,"branch_id": string,"lost": number,"maintenance": number,"out_now": number,"reserved_ahead": number,"total": number,"variation_id": string
            }[]
                           },
"is_platform_admin":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"mark_reminder_sent":
{ Args: { "p_kind": string,"p_rental_id": string }; Returns: undefined
                           },
"my_home_shop_id":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"next_shop_counter":
{ Args: { "p_kind": string,"p_period": string,"p_shop_id": string }; Returns: number
                           },
"pause_overdue_shops":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"plan_limit":
{ Args: { "p_kind": string,"p_plan": string }; Returns: number
                           },
"platform_overview":
{ Args: Record<PropertyKey, never>; Returns: {
              "active_logins": number,"branches": number,"business_types": (string)[],"created_at": string,"last_payment_amount": number,"last_payment_on": string,"monthly_fee": number,"name": string,"paid_until": string,"phone": string,"plan": string,"rentals_30d": number,"shop_id": string,"slug": string,"status": string,"token_prefix": string,"units": number
            }[]
                           },
"price_line":
{ Args: { "p_end": string,"p_qty": number,"p_start": string,"p_tz": string,"p_variation_id": string }; Returns: Record<string, unknown>
                           },
"quote_rental":
{ Args: { "p": Json }; Returns: Json
                           },
"recompute_rental_money":
{ Args: { "p_rental_id": string }; Returns: undefined
                           },
"record_rental_payment":
{ Args: { "p_amount": number,"p_kind": string,"p_method"?: string,"p_note"?: string,"p_rental_id": string }; Returns: Json
                           },
"record_shop_payment":
{ Args: { "p_amount": number,"p_kind"?: string,"p_method"?: string,"p_note"?: string,"p_paid_on": string,"p_period_to": string,"p_shop_id": string }; Returns: string
                           },
"rental_days":
{ Args: { "p_end": string,"p_start": string,"p_tz": string }; Returns: number
                           },
"rental_hours":
{ Args: { "p_end": string,"p_start": string }; Returns: number
                           },
"return_suggestions":
{ Args: { "p_odometers"?: Json,"p_rental_id": string,"p_returned_at"?: string }; Returns: Json
                           },
"save_product":
{ Args: { "p": Json }; Returns: string
                           },
"save_set_items":
{ Args: { "p_items": Json,"p_product_id": string }; Returns: undefined
                           },
"set_staff_branch":
{ Args: { "p_branch_id": string,"p_user_id": string }; Returns: undefined
                           },
"set_unit_status":
{ Args: { "p_reason"?: string,"p_status": string,"p_unit_id": string }; Returns: Json
                           },
"shop_detail":
{ Args: { "p_shop_id": string }; Returns: Json
                           },
"shop_feature":
{ Args: { "p_feature": string,"p_shop_id": string }; Returns: boolean
                           },
"start_rental":
{ Args: { "p"?: Json,"p_rental_id": string }; Returns: Json
                           },
"swap_unit":
{ Args: { "p_new_unit_id": string,"p_old_unit_id": string,"p_rental_id": string }; Returns: undefined
                           },
"switch_shop":
{ Args: { "p_shop_id": string }; Returns: undefined
                           },
"update_my_shop":
{ Args: { "p": Json }; Returns: undefined
                           },
"update_rental":
{ Args: { "p": Json,"p_rental_id": string }; Returns: Json
                           },
"update_rental_notes":
{ Args: { "p_notes": string,"p_rental_id": string }; Returns: undefined
                           },
"update_shop":
{ Args: { "p": Json,"p_shop_id": string }; Returns: undefined
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

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            
          }
        }
} as const
