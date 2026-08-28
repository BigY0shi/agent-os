import type { gmail_v1 } from "googleapis";

/**
 * SPEC-D G3.1 — verbatim-adapt of AOC integrations/gmail/src/mcp/filter-manager.ts
 * (any→gmail_v1.Gmail typing; logic unchanged).
 */

export interface GmailFilterCriteria {
  from?: string;
  to?: string;
  subject?: string;
  query?: string;
  negatedQuery?: string;
  hasAttachment?: boolean;
  excludeChats?: boolean;
  size?: number;
  sizeComparison?: "unspecified" | "smaller" | "larger";
}

export interface GmailFilterAction {
  addLabelIds?: string[];
  removeLabelIds?: string[];
  forward?: string;
}

export interface GmailFilter {
  id?: string;
  criteria: GmailFilterCriteria;
  action: GmailFilterAction;
}

/** Creates a new Gmail filter. */
export async function createFilter(
  gmail: gmail_v1.Gmail,
  criteria: GmailFilterCriteria,
  action: GmailFilterAction,
) {
  try {
    const filterBody: GmailFilter = { criteria, action };
    const response = await gmail.users.settings.filters.create({
      userId: "me",
      requestBody: filterBody,
    });
    return response.data;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if ((error as { code?: number }).code === 400) {
      throw new Error(`Invalid filter criteria or action: ${message}`);
    }
    throw new Error(`Failed to create filter: ${message}`);
  }
}

/** Lists all Gmail filters. */
export async function listFilters(gmail: gmail_v1.Gmail) {
  try {
    const response = await gmail.users.settings.filters.list({ userId: "me" });
    const filters = response.data.filter || [];
    return { filters, count: filters.length };
  } catch (error) {
    throw new Error(
      `Failed to list filters: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Gets a specific Gmail filter by ID. */
export async function getFilter(gmail: gmail_v1.Gmail, filterId: string) {
  try {
    const response = await gmail.users.settings.filters.get({
      userId: "me",
      id: filterId,
    });
    return response.data;
  } catch (error) {
    if ((error as { code?: number }).code === 404) {
      throw new Error(`Filter with ID "${filterId}" not found.`);
    }
    throw new Error(
      `Failed to get filter: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Deletes a Gmail filter. */
export async function deleteFilter(gmail: gmail_v1.Gmail, filterId: string) {
  try {
    await gmail.users.settings.filters.delete({ userId: "me", id: filterId });
    return { success: true, message: `Filter "${filterId}" deleted successfully.` };
  } catch (error) {
    if ((error as { code?: number }).code === 404) {
      throw new Error(`Filter with ID "${filterId}" not found.`);
    }
    throw new Error(
      `Failed to delete filter: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Helper templates for common filter patterns (verbatim). */
export const filterTemplates = {
  fromSender: (
    senderEmail: string,
    labelIds: string[] = [],
    archive: boolean = false,
  ): { criteria: GmailFilterCriteria; action: GmailFilterAction } => ({
    criteria: { from: senderEmail },
    action: {
      addLabelIds: labelIds,
      removeLabelIds: archive ? ["INBOX"] : undefined,
    },
  }),

  withSubject: (
    subjectText: string,
    labelIds: string[] = [],
    markAsRead: boolean = false,
  ): { criteria: GmailFilterCriteria; action: GmailFilterAction } => ({
    criteria: { subject: subjectText },
    action: {
      addLabelIds: labelIds,
      removeLabelIds: markAsRead ? ["UNREAD"] : undefined,
    },
  }),

  withAttachments: (
    labelIds: string[] = [],
  ): { criteria: GmailFilterCriteria; action: GmailFilterAction } => ({
    criteria: { hasAttachment: true },
    action: { addLabelIds: labelIds },
  }),

  largeEmails: (
    sizeInBytes: number,
    labelIds: string[] = [],
  ): { criteria: GmailFilterCriteria; action: GmailFilterAction } => ({
    criteria: { size: sizeInBytes, sizeComparison: "larger" },
    action: { addLabelIds: labelIds },
  }),

  containingText: (
    searchText: string,
    labelIds: string[] = [],
    markImportant: boolean = false,
  ): { criteria: GmailFilterCriteria; action: GmailFilterAction } => ({
    criteria: { query: `"${searchText}"` },
    action: {
      addLabelIds: markImportant ? [...labelIds, "IMPORTANT"] : labelIds,
    },
  }),

  mailingList: (
    listIdentifier: string,
    labelIds: string[] = [],
    archive: boolean = true,
  ): { criteria: GmailFilterCriteria; action: GmailFilterAction } => ({
    criteria: { query: `list:${listIdentifier} OR subject:[${listIdentifier}]` },
    action: {
      addLabelIds: labelIds,
      removeLabelIds: archive ? ["INBOX"] : undefined,
    },
  }),
};
