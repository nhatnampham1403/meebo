export type Json = string | number | boolean | null | { [k: string]: Json } | Json[];

export interface Database {
  public: {
    Tables: {
      task_drafts: {
        Row: {
          id: string;
          extracted_title: string;
          project: string | null;
          owner: string | null;
          owners: string[];
          trello_member_id: string | null;
          due_date: string | null;
          priority: 'low' | 'medium' | 'high';
          source_type: 'sprint_meeting' | 'customer_meeting';
          external_party: string | null;
          context: string;
          definition_of_done: string;
          suggested_list: string | null;
          checklist: string[] | null;
          decision_needed: boolean;
          confidence: 'high' | 'medium' | 'low';
          needs_clarification: boolean;
          meeting_summary: string | null;
          review_status: 'pending' | 'needs_clarification' | 'approved' | 'rejected';
          trello_card_id: string | null;
          trello_card_url: string | null;
          extracted_at: string;
          reviewed_at: string | null;
          original_source_text: string;
          meeting_id: string | null;
          source_channel: string;
        };
        Insert: {
          id?: string;
          extracted_title: string;
          project?: string | null;
          owner?: string | null;
          owners?: string[];
          trello_member_id?: string | null;
          due_date?: string | null;
          priority: 'low' | 'medium' | 'high';
          source_type: 'sprint_meeting' | 'customer_meeting';
          external_party?: string | null;
          context?: string;
          definition_of_done?: string;
          suggested_list?: string | null;
          checklist?: string[] | null;
          decision_needed?: boolean;
          confidence: 'high' | 'medium' | 'low';
          needs_clarification?: boolean;
          meeting_summary?: string | null;
          review_status?: 'pending' | 'needs_clarification' | 'approved' | 'rejected';
          trello_card_id?: string | null;
          trello_card_url?: string | null;
          extracted_at?: string;
          reviewed_at?: string | null;
          original_source_text: string;
          meeting_id?: string | null;
          source_channel?: string;
        };
        Update: {
          id?: string;
          extracted_title?: string;
          project?: string | null;
          owner?: string | null;
          owners?: string[];
          trello_member_id?: string | null;
          due_date?: string | null;
          priority?: 'low' | 'medium' | 'high';
          source_type?: 'sprint_meeting' | 'customer_meeting';
          external_party?: string | null;
          context?: string;
          definition_of_done?: string;
          suggested_list?: string | null;
          checklist?: string[] | null;
          decision_needed?: boolean;
          confidence?: 'high' | 'medium' | 'low';
          needs_clarification?: boolean;
          meeting_summary?: string | null;
          review_status?: 'pending' | 'needs_clarification' | 'approved' | 'rejected';
          trello_card_id?: string | null;
          trello_card_url?: string | null;
          extracted_at?: string;
          reviewed_at?: string | null;
          original_source_text?: string;
          meeting_id?: string | null;
          source_channel?: string;
        };
        Relationships: [];
      };
      meetings: {
        Row: {
          id: string;
          created_at: string;
          source_type: 'sprint_meeting' | 'customer_meeting';
          source_channel: 'web' | 'telegram';
          raw_transcript: string;
          summary: string | null;
          participants: string[] | null;
        };
        Insert: {
          id?: string;
          created_at?: string;
          source_type: 'sprint_meeting' | 'customer_meeting';
          source_channel?: 'web' | 'telegram';
          raw_transcript: string;
          summary?: string | null;
          participants?: string[] | null;
        };
        Update: {
          id?: string;
          created_at?: string;
          source_type?: 'sprint_meeting' | 'customer_meeting';
          source_channel?: 'web' | 'telegram';
          raw_transcript?: string;
          summary?: string | null;
          participants?: string[] | null;
        };
        Relationships: [];
      };
      team_members: {
        Row: {
          id: string;
          display_name: string;
          email: string | null;
          trello_member_id: string;
          telegram_user_id: string | null;
          role: string;
          skills: string[];
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          display_name: string;
          email?: string | null;
          trello_member_id: string;
          telegram_user_id?: string | null;
          role: string;
          skills?: string[];
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          display_name?: string;
          email?: string | null;
          trello_member_id?: string;
          telegram_user_id?: string | null;
          role?: string;
          skills?: string[];
          is_active?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      pending_checkins: {
        Row: {
          id: string;
          trello_card_id: string;
          member_id: string;
          telegram_message_id: string | null;
          prompted_at: string;
          reminder_sent_at: string | null;
          resolved_at: string | null;
          status: 'awaiting' | 'reminded' | 'resolved' | 'timed_out';
          response: 'done' | 'in_progress' | 'blocked' | null;
        };
        Insert: {
          id?: string;
          trello_card_id: string;
          member_id: string;
          telegram_message_id?: string | null;
          prompted_at?: string;
          reminder_sent_at?: string | null;
          resolved_at?: string | null;
          status?: 'awaiting' | 'reminded' | 'resolved' | 'timed_out';
          response?: 'done' | 'in_progress' | 'blocked' | null;
        };
        Update: {
          id?: string;
          trello_card_id?: string;
          member_id?: string;
          telegram_message_id?: string | null;
          prompted_at?: string;
          reminder_sent_at?: string | null;
          resolved_at?: string | null;
          status?: 'awaiting' | 'reminded' | 'resolved' | 'timed_out';
          response?: 'done' | 'in_progress' | 'blocked' | null;
        };
        Relationships: [];
      };
      member_stats: {
        Row: {
          id: string;
          member_id: string;
          task_category: string;
          total_assigned: number;
          completed_on_time: number;
          avg_days_to_complete: number | null;
          last_updated: string;
        };
        Insert: {
          id?: string;
          member_id: string;
          task_category: string;
          total_assigned?: number;
          completed_on_time?: number;
          avg_days_to_complete?: number | null;
          last_updated?: string;
        };
        Update: {
          id?: string;
          member_id?: string;
          task_category?: string;
          total_assigned?: number;
          completed_on_time?: number;
          avg_days_to_complete?: number | null;
          last_updated?: string;
        };
        Relationships: [];
      };
      digest_log: {
        Row: {
          id: string;
          job_name: string;
          reference_id: string | null;
          sent_at: string;
          sent_date: string;
        };
        Insert: {
          id?: string;
          job_name: string;
          reference_id?: string | null;
          sent_at?: string;
          sent_date?: string;
        };
        Update: {
          id?: string;
          job_name?: string;
          reference_id?: string | null;
          sent_at?: string;
          sent_date?: string;
        };
        Relationships: [];
      };
      trello_config: {
        Row: { key: string; value: string };
        Insert: { key: string; value: string };
        Update: { key?: string; value?: string };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
