"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AccountAccessKeyCache = void 0;
const path = require("path");
const fs = require("fs-extra");
const logging_1 = require("../../logging");
const directories_1 = require("../../util/directories");
/**
 * Disk cache which maps access key IDs to account IDs.
 * Usage:
 *   cache.get(accessKey) => accountId | undefined
 *   cache.put(accessKey, accountId)
 */
class AccountAccessKeyCache {
    /**
     * @param filePath Path to the cache file
     */
    constructor(filePath) {
        this.cacheFile = filePath || path.join((0, directories_1.cdkCacheDir)(), 'accounts_partitions.json');
    }
    /**
     * Tries to fetch the account ID from cache. If it's not in the cache, invokes
     * the resolver function which should retrieve the account ID and return it.
     * Then, it will be stored into disk cache returned.
     *
     * Example:
     *
     *    const accountId = cache.fetch(accessKey, async () => {
     *      return await fetchAccountIdFromSomewhere(accessKey);
     *    });
     *
     * @param accessKeyId
     * @param resolver
     */
    async fetch(accessKeyId, resolver) {
        // try to get account ID based on this access key ID from disk.
        const cached = await this.get(accessKeyId);
        if (cached) {
            (0, logging_1.debug)(`Retrieved account ID ${cached.accountId} from disk cache`);
            return cached;
        }
        // if it's not in the cache, resolve and put in cache.
        const account = await resolver();
        if (account) {
            await this.put(accessKeyId, account);
        }
        return account;
    }
    /** Get the account ID from an access key or undefined if not in cache */
    async get(accessKeyId) {
        const map = await this.loadMap();
        return map[accessKeyId];
    }
    /** Put a mapping between access key and account ID */
    async put(accessKeyId, account) {
        let map = await this.loadMap();
        // nuke cache if it's too big.
        if (Object.keys(map).length >= AccountAccessKeyCache.MAX_ENTRIES) {
            map = {};
        }
        map[accessKeyId] = account;
        await this.saveMap(map);
    }
    async loadMap() {
        try {
            return await fs.readJson(this.cacheFile);
        }
        catch (e) {
            // File doesn't exist or is not readable. This is a cache,
            // pretend we successfully loaded an empty map.
            if (e.code === 'ENOENT' || e.code === 'EACCES') {
                return {};
            }
            // File is not JSON, could be corrupted because of concurrent writes.
            // Again, an empty cache is fine.
            if (e instanceof SyntaxError) {
                return {};
            }
            throw e;
        }
    }
    async saveMap(map) {
        try {
            await fs.ensureFile(this.cacheFile);
            await fs.writeJson(this.cacheFile, map, { spaces: 2 });
        }
        catch (e) {
            // File doesn't exist or file/dir isn't writable. This is a cache,
            // if we can't write it then too bad.
            if (e.code === 'ENOENT' || e.code === 'EACCES' || e.code === 'EROFS') {
                return;
            }
            throw e;
        }
    }
}
exports.AccountAccessKeyCache = AccountAccessKeyCache;
/**
 * Max number of entries in the cache, after which the cache will be reset.
 */
AccountAccessKeyCache.MAX_ENTRIES = 1000;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYWNjb3VudC1jYWNoZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImFjY291bnQtY2FjaGUudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsNkJBQTZCO0FBQzdCLCtCQUErQjtBQUUvQiwyQ0FBc0M7QUFDdEMsd0RBQXFEO0FBRXJEOzs7OztHQUtHO0FBQ0gsTUFBYSxxQkFBcUI7SUFRaEM7O09BRUc7SUFDSCxZQUFZLFFBQWlCO1FBQzNCLElBQUksQ0FBQyxTQUFTLEdBQUcsUUFBUSxJQUFJLElBQUksQ0FBQyxJQUFJLENBQUMsSUFBQSx5QkFBVyxHQUFFLEVBQUUsMEJBQTBCLENBQUMsQ0FBQztJQUNwRixDQUFDO0lBRUQ7Ozs7Ozs7Ozs7Ozs7T0FhRztJQUNJLEtBQUssQ0FBQyxLQUFLLENBQW9CLFdBQW1CLEVBQUUsUUFBMEI7UUFDbkYsK0RBQStEO1FBQy9ELE1BQU0sTUFBTSxHQUFHLE1BQU0sSUFBSSxDQUFDLEdBQUcsQ0FBQyxXQUFXLENBQUMsQ0FBQztRQUMzQyxJQUFJLE1BQU0sRUFBRSxDQUFDO1lBQ1gsSUFBQSxlQUFLLEVBQUMsd0JBQXdCLE1BQU0sQ0FBQyxTQUFTLGtCQUFrQixDQUFDLENBQUM7WUFDbEUsT0FBTyxNQUFNLENBQUM7UUFDaEIsQ0FBQztRQUVELHNEQUFzRDtRQUN0RCxNQUFNLE9BQU8sR0FBRyxNQUFNLFFBQVEsRUFBRSxDQUFDO1FBQ2pDLElBQUksT0FBTyxFQUFFLENBQUM7WUFDWixNQUFNLElBQUksQ0FBQyxHQUFHLENBQUMsV0FBVyxFQUFFLE9BQU8sQ0FBQyxDQUFDO1FBQ3ZDLENBQUM7UUFFRCxPQUFPLE9BQU8sQ0FBQztJQUNqQixDQUFDO0lBRUQseUVBQXlFO0lBQ2xFLEtBQUssQ0FBQyxHQUFHLENBQUMsV0FBbUI7UUFDbEMsTUFBTSxHQUFHLEdBQUcsTUFBTSxJQUFJLENBQUMsT0FBTyxFQUFFLENBQUM7UUFDakMsT0FBTyxHQUFHLENBQUMsV0FBVyxDQUFDLENBQUM7SUFDMUIsQ0FBQztJQUVELHNEQUFzRDtJQUMvQyxLQUFLLENBQUMsR0FBRyxDQUFDLFdBQW1CLEVBQUUsT0FBZ0I7UUFDcEQsSUFBSSxHQUFHLEdBQUcsTUFBTSxJQUFJLENBQUMsT0FBTyxFQUFFLENBQUM7UUFFL0IsOEJBQThCO1FBQzlCLElBQUksTUFBTSxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxNQUFNLElBQUkscUJBQXFCLENBQUMsV0FBVyxFQUFFLENBQUM7WUFDakUsR0FBRyxHQUFHLEVBQUUsQ0FBQztRQUNYLENBQUM7UUFFRCxHQUFHLENBQUMsV0FBVyxDQUFDLEdBQUcsT0FBTyxDQUFDO1FBQzNCLE1BQU0sSUFBSSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQztJQUMxQixDQUFDO0lBRU8sS0FBSyxDQUFDLE9BQU87UUFDbkIsSUFBSSxDQUFDO1lBQ0gsT0FBTyxNQUFNLEVBQUUsQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFDO1FBQzNDLENBQUM7UUFBQyxPQUFPLENBQU0sRUFBRSxDQUFDO1lBQ2hCLDBEQUEwRDtZQUMxRCwrQ0FBK0M7WUFDL0MsSUFBSSxDQUFDLENBQUMsSUFBSSxLQUFLLFFBQVEsSUFBSSxDQUFDLENBQUMsSUFBSSxLQUFLLFFBQVEsRUFBRSxDQUFDO2dCQUMvQyxPQUFPLEVBQUUsQ0FBQztZQUNaLENBQUM7WUFDRCxxRUFBcUU7WUFDckUsaUNBQWlDO1lBQ2pDLElBQUksQ0FBQyxZQUFZLFdBQVcsRUFBRSxDQUFDO2dCQUM3QixPQUFPLEVBQUUsQ0FBQztZQUNaLENBQUM7WUFDRCxNQUFNLENBQUMsQ0FBQztRQUNWLENBQUM7SUFDSCxDQUFDO0lBRU8sS0FBSyxDQUFDLE9BQU8sQ0FBQyxHQUF1QztRQUMzRCxJQUFJLENBQUM7WUFDSCxNQUFNLEVBQUUsQ0FBQyxVQUFVLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFDO1lBQ3BDLE1BQU0sRUFBRSxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLEdBQUcsRUFBRSxFQUFFLE1BQU0sRUFBRSxDQUFDLEVBQUUsQ0FBQyxDQUFDO1FBQ3pELENBQUM7UUFBQyxPQUFPLENBQU0sRUFBRSxDQUFDO1lBQ2hCLGtFQUFrRTtZQUNsRSxxQ0FBcUM7WUFDckMsSUFBSSxDQUFDLENBQUMsSUFBSSxLQUFLLFFBQVEsSUFBSSxDQUFDLENBQUMsSUFBSSxLQUFLLFFBQVEsSUFBSSxDQUFDLENBQUMsSUFBSSxLQUFLLE9BQU8sRUFBRSxDQUFDO2dCQUNyRSxPQUFPO1lBQ1QsQ0FBQztZQUNELE1BQU0sQ0FBQyxDQUFDO1FBQ1YsQ0FBQztJQUNILENBQUM7O0FBL0ZILHNEQWdHQztBQS9GQzs7R0FFRztBQUNvQixpQ0FBVyxHQUFHLElBQUksQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIHBhdGggZnJvbSAncGF0aCc7XG5pbXBvcnQgKiBhcyBmcyBmcm9tICdmcy1leHRyYSc7XG5pbXBvcnQgeyBBY2NvdW50IH0gZnJvbSAnLi9zZGstcHJvdmlkZXInO1xuaW1wb3J0IHsgZGVidWcgfSBmcm9tICcuLi8uLi9sb2dnaW5nJztcbmltcG9ydCB7IGNka0NhY2hlRGlyIH0gZnJvbSAnLi4vLi4vdXRpbC9kaXJlY3Rvcmllcyc7XG5cbi8qKlxuICogRGlzayBjYWNoZSB3aGljaCBtYXBzIGFjY2VzcyBrZXkgSURzIHRvIGFjY291bnQgSURzLlxuICogVXNhZ2U6XG4gKiAgIGNhY2hlLmdldChhY2Nlc3NLZXkpID0+IGFjY291bnRJZCB8IHVuZGVmaW5lZFxuICogICBjYWNoZS5wdXQoYWNjZXNzS2V5LCBhY2NvdW50SWQpXG4gKi9cbmV4cG9ydCBjbGFzcyBBY2NvdW50QWNjZXNzS2V5Q2FjaGUge1xuICAvKipcbiAgICogTWF4IG51bWJlciBvZiBlbnRyaWVzIGluIHRoZSBjYWNoZSwgYWZ0ZXIgd2hpY2ggdGhlIGNhY2hlIHdpbGwgYmUgcmVzZXQuXG4gICAqL1xuICBwdWJsaWMgc3RhdGljIHJlYWRvbmx5IE1BWF9FTlRSSUVTID0gMTAwMDtcblxuICBwcml2YXRlIHJlYWRvbmx5IGNhY2hlRmlsZTogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBAcGFyYW0gZmlsZVBhdGggUGF0aCB0byB0aGUgY2FjaGUgZmlsZVxuICAgKi9cbiAgY29uc3RydWN0b3IoZmlsZVBhdGg/OiBzdHJpbmcpIHtcbiAgICB0aGlzLmNhY2hlRmlsZSA9IGZpbGVQYXRoIHx8IHBhdGguam9pbihjZGtDYWNoZURpcigpLCAnYWNjb3VudHNfcGFydGl0aW9ucy5qc29uJyk7XG4gIH1cblxuICAvKipcbiAgICogVHJpZXMgdG8gZmV0Y2ggdGhlIGFjY291bnQgSUQgZnJvbSBjYWNoZS4gSWYgaXQncyBub3QgaW4gdGhlIGNhY2hlLCBpbnZva2VzXG4gICAqIHRoZSByZXNvbHZlciBmdW5jdGlvbiB3aGljaCBzaG91bGQgcmV0cmlldmUgdGhlIGFjY291bnQgSUQgYW5kIHJldHVybiBpdC5cbiAgICogVGhlbiwgaXQgd2lsbCBiZSBzdG9yZWQgaW50byBkaXNrIGNhY2hlIHJldHVybmVkLlxuICAgKlxuICAgKiBFeGFtcGxlOlxuICAgKlxuICAgKiAgICBjb25zdCBhY2NvdW50SWQgPSBjYWNoZS5mZXRjaChhY2Nlc3NLZXksIGFzeW5jICgpID0+IHtcbiAgICogICAgICByZXR1cm4gYXdhaXQgZmV0Y2hBY2NvdW50SWRGcm9tU29tZXdoZXJlKGFjY2Vzc0tleSk7XG4gICAqICAgIH0pO1xuICAgKlxuICAgKiBAcGFyYW0gYWNjZXNzS2V5SWRcbiAgICogQHBhcmFtIHJlc29sdmVyXG4gICAqL1xuICBwdWJsaWMgYXN5bmMgZmV0Y2g8QSBleHRlbmRzIEFjY291bnQ+KGFjY2Vzc0tleUlkOiBzdHJpbmcsIHJlc29sdmVyOiAoKSA9PiBQcm9taXNlPEE+KSB7XG4gICAgLy8gdHJ5IHRvIGdldCBhY2NvdW50IElEIGJhc2VkIG9uIHRoaXMgYWNjZXNzIGtleSBJRCBmcm9tIGRpc2suXG4gICAgY29uc3QgY2FjaGVkID0gYXdhaXQgdGhpcy5nZXQoYWNjZXNzS2V5SWQpO1xuICAgIGlmIChjYWNoZWQpIHtcbiAgICAgIGRlYnVnKGBSZXRyaWV2ZWQgYWNjb3VudCBJRCAke2NhY2hlZC5hY2NvdW50SWR9IGZyb20gZGlzayBjYWNoZWApO1xuICAgICAgcmV0dXJuIGNhY2hlZDtcbiAgICB9XG5cbiAgICAvLyBpZiBpdCdzIG5vdCBpbiB0aGUgY2FjaGUsIHJlc29sdmUgYW5kIHB1dCBpbiBjYWNoZS5cbiAgICBjb25zdCBhY2NvdW50ID0gYXdhaXQgcmVzb2x2ZXIoKTtcbiAgICBpZiAoYWNjb3VudCkge1xuICAgICAgYXdhaXQgdGhpcy5wdXQoYWNjZXNzS2V5SWQsIGFjY291bnQpO1xuICAgIH1cblxuICAgIHJldHVybiBhY2NvdW50O1xuICB9XG5cbiAgLyoqIEdldCB0aGUgYWNjb3VudCBJRCBmcm9tIGFuIGFjY2VzcyBrZXkgb3IgdW5kZWZpbmVkIGlmIG5vdCBpbiBjYWNoZSAqL1xuICBwdWJsaWMgYXN5bmMgZ2V0KGFjY2Vzc0tleUlkOiBzdHJpbmcpOiBQcm9taXNlPEFjY291bnQgfCB1bmRlZmluZWQ+IHtcbiAgICBjb25zdCBtYXAgPSBhd2FpdCB0aGlzLmxvYWRNYXAoKTtcbiAgICByZXR1cm4gbWFwW2FjY2Vzc0tleUlkXTtcbiAgfVxuXG4gIC8qKiBQdXQgYSBtYXBwaW5nIGJldHdlZW4gYWNjZXNzIGtleSBhbmQgYWNjb3VudCBJRCAqL1xuICBwdWJsaWMgYXN5bmMgcHV0KGFjY2Vzc0tleUlkOiBzdHJpbmcsIGFjY291bnQ6IEFjY291bnQpIHtcbiAgICBsZXQgbWFwID0gYXdhaXQgdGhpcy5sb2FkTWFwKCk7XG5cbiAgICAvLyBudWtlIGNhY2hlIGlmIGl0J3MgdG9vIGJpZy5cbiAgICBpZiAoT2JqZWN0LmtleXMobWFwKS5sZW5ndGggPj0gQWNjb3VudEFjY2Vzc0tleUNhY2hlLk1BWF9FTlRSSUVTKSB7XG4gICAgICBtYXAgPSB7fTtcbiAgICB9XG5cbiAgICBtYXBbYWNjZXNzS2V5SWRdID0gYWNjb3VudDtcbiAgICBhd2FpdCB0aGlzLnNhdmVNYXAobWFwKTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgbG9hZE1hcCgpOiBQcm9taXNlPHsgW2FjY2Vzc0tleUlkOiBzdHJpbmddOiBBY2NvdW50IH0+IHtcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGF3YWl0IGZzLnJlYWRKc29uKHRoaXMuY2FjaGVGaWxlKTtcbiAgICB9IGNhdGNoIChlOiBhbnkpIHtcbiAgICAgIC8vIEZpbGUgZG9lc24ndCBleGlzdCBvciBpcyBub3QgcmVhZGFibGUuIFRoaXMgaXMgYSBjYWNoZSxcbiAgICAgIC8vIHByZXRlbmQgd2Ugc3VjY2Vzc2Z1bGx5IGxvYWRlZCBhbiBlbXB0eSBtYXAuXG4gICAgICBpZiAoZS5jb2RlID09PSAnRU5PRU5UJyB8fCBlLmNvZGUgPT09ICdFQUNDRVMnKSB7XG4gICAgICAgIHJldHVybiB7fTtcbiAgICAgIH1cbiAgICAgIC8vIEZpbGUgaXMgbm90IEpTT04sIGNvdWxkIGJlIGNvcnJ1cHRlZCBiZWNhdXNlIG9mIGNvbmN1cnJlbnQgd3JpdGVzLlxuICAgICAgLy8gQWdhaW4sIGFuIGVtcHR5IGNhY2hlIGlzIGZpbmUuXG4gICAgICBpZiAoZSBpbnN0YW5jZW9mIFN5bnRheEVycm9yKSB7XG4gICAgICAgIHJldHVybiB7fTtcbiAgICAgIH1cbiAgICAgIHRocm93IGU7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBzYXZlTWFwKG1hcDogeyBbYWNjZXNzS2V5SWQ6IHN0cmluZ106IEFjY291bnQgfSkge1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCBmcy5lbnN1cmVGaWxlKHRoaXMuY2FjaGVGaWxlKTtcbiAgICAgIGF3YWl0IGZzLndyaXRlSnNvbih0aGlzLmNhY2hlRmlsZSwgbWFwLCB7IHNwYWNlczogMiB9KTtcbiAgICB9IGNhdGNoIChlOiBhbnkpIHtcbiAgICAgIC8vIEZpbGUgZG9lc24ndCBleGlzdCBvciBmaWxlL2RpciBpc24ndCB3cml0YWJsZS4gVGhpcyBpcyBhIGNhY2hlLFxuICAgICAgLy8gaWYgd2UgY2FuJ3Qgd3JpdGUgaXQgdGhlbiB0b28gYmFkLlxuICAgICAgaWYgKGUuY29kZSA9PT0gJ0VOT0VOVCcgfHwgZS5jb2RlID09PSAnRUFDQ0VTJyB8fCBlLmNvZGUgPT09ICdFUk9GUycpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgdGhyb3cgZTtcbiAgICB9XG4gIH1cbn1cbiJdfQ==