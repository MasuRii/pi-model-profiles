export class ModelProfilesError extends Error {
	readonly code: string;

	constructor(message: string, code = "MODEL_PROFILES_ERROR") {
		super(message);
		this.name = "ModelProfilesError";
		this.code = code;
	}
}

export function toErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message.trim()) {
		return error.message;
	}
	return String(error);
}
