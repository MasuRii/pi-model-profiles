import { multiProfilesDebugLogger } from "./debug-logger.js";
import { loadMultiProfilesConfig, saveMultiProfilesConfig } from "./config.js";
import type { ProfileSortResult, ProfilesFile, SavedProfile } from "./types.js";
import type { ProfileSortOrder } from "./types.js";

/**
 * Compare two profile names using locale-aware string comparison.
 */
function compareByName(left: SavedProfile, right: SavedProfile): number {
	return left.name.localeCompare(right.name);
}

/**
 * Compare two profiles by their createdAt timestamp.
 */
function compareByDate(left: SavedProfile, right: SavedProfile): number {
	const leftDate = new Date(left.createdAt).getTime();
	const rightDate = new Date(right.createdAt).getTime();
	return leftDate - rightDate;
}

/**
 * Sort profiles based on the specified order.
 * Returns a new array (immutable pattern), preserving the original data.profiles.
 * 
 * @param data - The profiles file containing the profiles array
 * @param order - The sort order to apply
 * @returns ProfileSortResult with sorted profiles and applied sort order
 */
export function sortProfiles(data: ProfilesFile, order: ProfileSortOrder): ProfileSortResult {
	const comparator = getSortComparator(order);
	const sortedProfiles = [...data.profiles].sort(comparator);

	return {
		sortedProfiles,
		sortOrder: order,
	};
}

/**
 * Get the comparator function for a given sort order.
 */
function getSortComparator(order: ProfileSortOrder): (left: SavedProfile, right: SavedProfile) => number {
	switch (order) {
		case "name-asc":
			return compareByName;
		case "name-desc":
			return (left, right) => compareByName(right, left);
		case "date-asc":
			return compareByDate;
		case "date-desc":
			return (left, right) => compareByDate(right, left);
	}
}

/**
 * Get the current sort order from config.
 */
export function getCurrentSortOrder(): ProfileSortOrder {
	const result = loadMultiProfilesConfig();
	return result.config.sorting.defaultSort;
}

/**
 * Persist the sort order to config.
 */
export function persistSortOrder(order: ProfileSortOrder): void {
	const result = loadMultiProfilesConfig();
	const config = result.config;
	config.sorting.defaultSort = order;
	saveMultiProfilesConfig(config);

	multiProfilesDebugLogger.log("config", {
		event: "sort_order_persisted",
		order,
	});
}

/**
 * Get display label for a sort order.
 */
export function getSortOrderLabel(order: ProfileSortOrder): string {
	switch (order) {
		case "name-asc":
			return "Name (A-Z)";
		case "name-desc":
			return "Name (Z-A)";
		case "date-asc":
			return "Date (Oldest)";
		case "date-desc":
			return "Date (Newest)";
	}
}

/**
 * Get all available sort orders with their labels.
 */
export function getAvailableSortOrders(): Array<{ order: ProfileSortOrder; label: string }> {
	return [
		{ order: "name-asc", label: "Name (A-Z)" },
		{ order: "name-desc", label: "Name (Z-A)" },
		{ order: "date-asc", label: "Date (Oldest)" },
		{ order: "date-desc", label: "Date (Newest)" },
	];
}
