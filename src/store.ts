import { AsyncStorage } from "react-native";
import stringify from "json-stringify-safe";
import uuidv4 from "uuid/v4";
import { Thought, SavedThought } from "./thoughts";

const EXISTING_USER_KEY = "@Quirk:existing-user";
const THOUGHTS_KEY_PREFIX = `@Quirk:thoughts:`;
const DELETED_KEY_PREFIX = `@Quirk:deleted-thoughts:`
const EXPIRY_MINUTES = 7 * 24 * 60; // Keep deleted thoughts for a week

export function getThoughtKey(info): string {
  return THOUGHTS_KEY_PREFIX + info;
}

export async function exists(key: string): Promise<boolean> {
  try {
    const value = await AsyncStorage.getItem(key);
    return !!value;
  } catch (err) {
    console.error(err);
    return false;
  }
}

export async function getIsExistingUser(): Promise<boolean> {
  try {
    const value = await AsyncStorage.getItem(EXISTING_USER_KEY);
    return !!value;
  } catch (err) {
    console.error(err);
    return false;
  }
}

export async function setIsExistingUser() {
  try {
    await AsyncStorage.setItem(EXISTING_USER_KEY, "true");
  } catch (err) {
    console.error(err);
  }
}

export const saveExercise = async (
  thought: SavedThought | Thought
): Promise<Thought> => {
  let saveableThought: SavedThought;

  const isSavedThought = (thought as SavedThought).uuid === undefined;
  if (isSavedThought) {
    saveableThought = {
      uuid: getThoughtKey(uuidv4()),
      createdAt: new Date(),
      updatedAt: new Date(),
      ...thought,
    };
  } else {
    saveableThought = thought as SavedThought;
    saveableThought.updatedAt = new Date();
  }

  return saveThought(saveableThought);
};

async function saveThought(saveableThought: SavedThought): Promise<SavedThought> {
  try {
    const thoughtString = stringify(saveableThought);

    // No matter what, we NEVER save bad data.
    if (!thoughtString || thoughtString.length <= 0) {
      console.warn("something went very wrong stringifying this data");
      return saveableThought;
    }

    await AsyncStorage.setItem(saveableThought.uuid, thoughtString);
    return saveableThought;
  } catch (error) {
    console.error(error);
    return saveableThought;
  }
};

export const deleteExercise = async (uuid: string) => {
  try {
    var thought: SavedThought = JSON.parse(await AsyncStorage.getItem(uuid));
    // Update to now so that we can 'expire' thoughts when they get too old.
    thought.updatedAt = new Date();
    if (uuid.startsWith(THOUGHTS_KEY_PREFIX)){
      // 'Move' the thought to the archive by deleting the thought with the THOUGHTS_KEY_PREFIX
      // and adding it with the DELETED_KEY_PREFIX. It would be more efficient to store and delete
      // in parallel, but we want the store to complete first in case anything goes wrong so nothing
      // is lost.
      thought.uuid = uuid.replace(THOUGHTS_KEY_PREFIX, DELETED_KEY_PREFIX);
      await saveThought(thought).then(() => AsyncStorage.removeItem(uuid));
    } else {
      // Delete the thought permanently
      await AsyncStorage.removeItem(uuid);
    }
  } catch (error) {
    console.error(error);
  }
};

export const restoreExercise = async (uuid: string) => {
  try {
    var thought: SavedThought = JSON.parse(await AsyncStorage.getItem(uuid));
    thought.updatedAt = new Date();
    // 'Move' the thought out of the archive into normal storage by deleting the thought
    // with the DELETED_KEY_PREFIX and storing it with the THOUGHTS_KEY_PREFIX.
    // Make sure the restore occurs successfully BEFORE we try deleting it to make sure no
    // thoughts are lost.
    thought.uuid = uuid.replace(DELETED_KEY_PREFIX, THOUGHTS_KEY_PREFIX);
    await saveThought(thought).then(() => AsyncStorage.removeItem(uuid));
  } catch (error) {
    console.error(error);
  }
};

export interface StoredThoughts {
  savedThoughts: SavedThought[],
  deletedThoughts: SavedThought[]
}

export const getExercises = async (): Promise<StoredThoughts> => {
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter(key =>
      key.startsWith(THOUGHTS_KEY_PREFIX) || key.startsWith(DELETED_KEY_PREFIX)
    );

    let rows = await AsyncStorage.multiGet(keys);

    // It's better to lose data than to brick the app
    // (though losing data is really bad too)
    if (!rows) {
      rows = [];
    }

    // This filter removes "null", "undefined"
    // which we should _never_ ever ever ever let
    // get back to the user since it'll brick their app
    rows = rows.filter(n => n && n[1]);

    const isExpired = (date: Date): boolean => new Date().getMinutes() - date.getMinutes() > EXPIRY_MINUTES;

    var result = { savedThoughts: [], deletedThoughts: [] };
    var outdatedDeletedThoughts = [];
    rows.forEach(x => {
      var key: string = x[0];
      var value: SavedThought = JSON.parse(x[1]);
      if (key.startsWith(THOUGHTS_KEY_PREFIX))
        result.savedThoughts.push(value);
      else if (isExpired(new Date(value.updatedAt)))
        outdatedDeletedThoughts.push(x[0]);
      else
        result.deletedThoughts.push(value);
    });

    AsyncStorage.multiRemove(outdatedDeletedThoughts);

    return result;
  } catch (error) {
    console.error(error);
    return { savedThoughts: [], deletedThoughts: [] };
  }
};
