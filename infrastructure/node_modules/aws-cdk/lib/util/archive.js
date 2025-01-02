"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.zipDirectory = zipDirectory;
const console_1 = require("console");
const fs_1 = require("fs");
const path = require("path");
const glob = require("glob");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const archiver = require('archiver');
// Adapted from cdk-assets
async function zipDirectory(directory, outputFile) {
    // We write to a temporary file and rename at the last moment. This is so that if we are
    // interrupted during this process, we don't leave a half-finished file in the target location.
    const temporaryOutputFile = `${outputFile}.${randomString()}._tmp`;
    await writeZipFile(directory, temporaryOutputFile);
    await moveIntoPlace(temporaryOutputFile, outputFile);
}
function writeZipFile(directory, outputFile) {
    return new Promise(async (ok, fail) => {
        // The below options are needed to support following symlinks when building zip files:
        // - nodir: This will prevent symlinks themselves from being copied into the zip.
        // - follow: This will follow symlinks and copy the files within.
        const globOptions = {
            dot: true,
            nodir: true,
            follow: true,
            cwd: directory,
        };
        const files = glob.sync('**', globOptions); // The output here is already sorted
        const output = (0, fs_1.createWriteStream)(outputFile);
        const archive = archiver('zip');
        archive.on('warning', fail);
        archive.on('error', fail);
        // archive has been finalized and the output file descriptor has closed, resolve promise
        // this has to be done before calling `finalize` since the events may fire immediately after.
        // see https://www.npmjs.com/package/archiver
        output.once('close', ok);
        archive.pipe(output);
        // Append files serially to ensure file order
        for (const file of files) {
            const fullPath = path.resolve(directory, file);
            // Exactly 2 promises
            // eslint-disable-next-line @cdklabs/promiseall-no-unbounded-parallelism
            const [data, stat] = await Promise.all([fs_1.promises.readFile(fullPath), fs_1.promises.stat(fullPath)]);
            archive.append(data, {
                name: file,
                mode: stat.mode,
            });
        }
        await archive.finalize();
    });
}
/**
 * Rename the file to the target location, taking into account:
 *
 * - That we may see EPERM on Windows while an Antivirus scanner still has the
 *   file open, so retry a couple of times.
 * - This same function may be called in parallel and be interrupted at any point.
 */
async function moveIntoPlace(source, target) {
    let delay = 100;
    let attempts = 5;
    while (true) {
        try {
            // 'rename' is guaranteed to overwrite an existing target, as long as it is a file (not a directory)
            await fs_1.promises.rename(source, target);
            return;
        }
        catch (e) {
            if (e.code !== 'EPERM' || attempts-- <= 0) {
                throw e;
            }
            (0, console_1.error)(e.message);
            await sleep(Math.floor(Math.random() * delay));
            delay *= 2;
        }
    }
}
function sleep(ms) {
    return new Promise(ok => setTimeout(ok, ms));
}
function randomString() {
    return Math.random().toString(36).replace(/[^a-z0-9]+/g, '');
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXJjaGl2ZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImFyY2hpdmUudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFTQSxvQ0FNQztBQWZELHFDQUFnQztBQUNoQywyQkFBdUQ7QUFDdkQsNkJBQTZCO0FBQzdCLDZCQUE2QjtBQUU3QixpRUFBaUU7QUFDakUsTUFBTSxRQUFRLEdBQUcsT0FBTyxDQUFDLFVBQVUsQ0FBQyxDQUFDO0FBRXJDLDBCQUEwQjtBQUNuQixLQUFLLFVBQVUsWUFBWSxDQUFDLFNBQWlCLEVBQUUsVUFBa0I7SUFDdEUsd0ZBQXdGO0lBQ3hGLCtGQUErRjtJQUMvRixNQUFNLG1CQUFtQixHQUFHLEdBQUcsVUFBVSxJQUFJLFlBQVksRUFBRSxPQUFPLENBQUM7SUFDbkUsTUFBTSxZQUFZLENBQUMsU0FBUyxFQUFFLG1CQUFtQixDQUFDLENBQUM7SUFDbkQsTUFBTSxhQUFhLENBQUMsbUJBQW1CLEVBQUUsVUFBVSxDQUFDLENBQUM7QUFDdkQsQ0FBQztBQUVELFNBQVMsWUFBWSxDQUFDLFNBQWlCLEVBQUUsVUFBa0I7SUFDekQsT0FBTyxJQUFJLE9BQU8sQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLElBQUksRUFBRSxFQUFFO1FBQ3BDLHNGQUFzRjtRQUN0RixpRkFBaUY7UUFDakYsaUVBQWlFO1FBQ2pFLE1BQU0sV0FBVyxHQUFHO1lBQ2xCLEdBQUcsRUFBRSxJQUFJO1lBQ1QsS0FBSyxFQUFFLElBQUk7WUFDWCxNQUFNLEVBQUUsSUFBSTtZQUNaLEdBQUcsRUFBRSxTQUFTO1NBQ2YsQ0FBQztRQUNGLE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLFdBQVcsQ0FBQyxDQUFDLENBQUMsb0NBQW9DO1FBRWhGLE1BQU0sTUFBTSxHQUFHLElBQUEsc0JBQWlCLEVBQUMsVUFBVSxDQUFDLENBQUM7UUFFN0MsTUFBTSxPQUFPLEdBQUcsUUFBUSxDQUFDLEtBQUssQ0FBQyxDQUFDO1FBQ2hDLE9BQU8sQ0FBQyxFQUFFLENBQUMsU0FBUyxFQUFFLElBQUksQ0FBQyxDQUFDO1FBQzVCLE9BQU8sQ0FBQyxFQUFFLENBQUMsT0FBTyxFQUFFLElBQUksQ0FBQyxDQUFDO1FBRTFCLHdGQUF3RjtRQUN4Riw2RkFBNkY7UUFDN0YsNkNBQTZDO1FBQzdDLE1BQU0sQ0FBQyxJQUFJLENBQUMsT0FBTyxFQUFFLEVBQUUsQ0FBQyxDQUFDO1FBRXpCLE9BQU8sQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUM7UUFFckIsNkNBQTZDO1FBQzdDLEtBQUssTUFBTSxJQUFJLElBQUksS0FBSyxFQUFFLENBQUM7WUFDekIsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLE9BQU8sQ0FBQyxTQUFTLEVBQUUsSUFBSSxDQUFDLENBQUM7WUFDL0MscUJBQXFCO1lBQ3JCLHdFQUF3RTtZQUN4RSxNQUFNLENBQUMsSUFBSSxFQUFFLElBQUksQ0FBQyxHQUFHLE1BQU0sT0FBTyxDQUFDLEdBQUcsQ0FBQyxDQUFDLGFBQUUsQ0FBQyxRQUFRLENBQUMsUUFBUSxDQUFDLEVBQUUsYUFBRSxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFDbkYsT0FBTyxDQUFDLE1BQU0sQ0FBQyxJQUFJLEVBQUU7Z0JBQ25CLElBQUksRUFBRSxJQUFJO2dCQUNWLElBQUksRUFBRSxJQUFJLENBQUMsSUFBSTthQUNoQixDQUFDLENBQUM7UUFDTCxDQUFDO1FBRUQsTUFBTSxPQUFPLENBQUMsUUFBUSxFQUFFLENBQUM7SUFDM0IsQ0FBQyxDQUFDLENBQUM7QUFDTCxDQUFDO0FBRUQ7Ozs7OztHQU1HO0FBQ0gsS0FBSyxVQUFVLGFBQWEsQ0FBQyxNQUFjLEVBQUUsTUFBYztJQUN6RCxJQUFJLEtBQUssR0FBRyxHQUFHLENBQUM7SUFDaEIsSUFBSSxRQUFRLEdBQUcsQ0FBQyxDQUFDO0lBQ2pCLE9BQU8sSUFBSSxFQUFFLENBQUM7UUFDWixJQUFJLENBQUM7WUFDSCxvR0FBb0c7WUFDcEcsTUFBTSxhQUFFLENBQUMsTUFBTSxDQUFDLE1BQU0sRUFBRSxNQUFNLENBQUMsQ0FBQztZQUNoQyxPQUFPO1FBQ1QsQ0FBQztRQUFDLE9BQU8sQ0FBTSxFQUFFLENBQUM7WUFDaEIsSUFBSSxDQUFDLENBQUMsSUFBSSxLQUFLLE9BQU8sSUFBSSxRQUFRLEVBQUUsSUFBSSxDQUFDLEVBQUUsQ0FBQztnQkFDMUMsTUFBTSxDQUFDLENBQUM7WUFDVixDQUFDO1lBQ0QsSUFBQSxlQUFLLEVBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDO1lBQ2pCLE1BQU0sS0FBSyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLE1BQU0sRUFBRSxHQUFHLEtBQUssQ0FBQyxDQUFDLENBQUM7WUFDL0MsS0FBSyxJQUFJLENBQUMsQ0FBQztRQUNiLENBQUM7SUFDSCxDQUFDO0FBQ0gsQ0FBQztBQUVELFNBQVMsS0FBSyxDQUFDLEVBQVU7SUFDdkIsT0FBTyxJQUFJLE9BQU8sQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLFVBQVUsQ0FBQyxFQUFFLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQztBQUMvQyxDQUFDO0FBRUQsU0FBUyxZQUFZO0lBQ25CLE9BQU8sSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFDLFFBQVEsQ0FBQyxFQUFFLENBQUMsQ0FBQyxPQUFPLENBQUMsYUFBYSxFQUFFLEVBQUUsQ0FBQyxDQUFDO0FBQy9ELENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBlcnJvciB9IGZyb20gJ2NvbnNvbGUnO1xuaW1wb3J0IHsgY3JlYXRlV3JpdGVTdHJlYW0sIHByb21pc2VzIGFzIGZzIH0gZnJvbSAnZnMnO1xuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCAqIGFzIGdsb2IgZnJvbSAnZ2xvYic7XG5cbi8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvbm8tcmVxdWlyZS1pbXBvcnRzXG5jb25zdCBhcmNoaXZlciA9IHJlcXVpcmUoJ2FyY2hpdmVyJyk7XG5cbi8vIEFkYXB0ZWQgZnJvbSBjZGstYXNzZXRzXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gemlwRGlyZWN0b3J5KGRpcmVjdG9yeTogc3RyaW5nLCBvdXRwdXRGaWxlOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgLy8gV2Ugd3JpdGUgdG8gYSB0ZW1wb3JhcnkgZmlsZSBhbmQgcmVuYW1lIGF0IHRoZSBsYXN0IG1vbWVudC4gVGhpcyBpcyBzbyB0aGF0IGlmIHdlIGFyZVxuICAvLyBpbnRlcnJ1cHRlZCBkdXJpbmcgdGhpcyBwcm9jZXNzLCB3ZSBkb24ndCBsZWF2ZSBhIGhhbGYtZmluaXNoZWQgZmlsZSBpbiB0aGUgdGFyZ2V0IGxvY2F0aW9uLlxuICBjb25zdCB0ZW1wb3JhcnlPdXRwdXRGaWxlID0gYCR7b3V0cHV0RmlsZX0uJHtyYW5kb21TdHJpbmcoKX0uX3RtcGA7XG4gIGF3YWl0IHdyaXRlWmlwRmlsZShkaXJlY3RvcnksIHRlbXBvcmFyeU91dHB1dEZpbGUpO1xuICBhd2FpdCBtb3ZlSW50b1BsYWNlKHRlbXBvcmFyeU91dHB1dEZpbGUsIG91dHB1dEZpbGUpO1xufVxuXG5mdW5jdGlvbiB3cml0ZVppcEZpbGUoZGlyZWN0b3J5OiBzdHJpbmcsIG91dHB1dEZpbGU6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICByZXR1cm4gbmV3IFByb21pc2UoYXN5bmMgKG9rLCBmYWlsKSA9PiB7XG4gICAgLy8gVGhlIGJlbG93IG9wdGlvbnMgYXJlIG5lZWRlZCB0byBzdXBwb3J0IGZvbGxvd2luZyBzeW1saW5rcyB3aGVuIGJ1aWxkaW5nIHppcCBmaWxlczpcbiAgICAvLyAtIG5vZGlyOiBUaGlzIHdpbGwgcHJldmVudCBzeW1saW5rcyB0aGVtc2VsdmVzIGZyb20gYmVpbmcgY29waWVkIGludG8gdGhlIHppcC5cbiAgICAvLyAtIGZvbGxvdzogVGhpcyB3aWxsIGZvbGxvdyBzeW1saW5rcyBhbmQgY29weSB0aGUgZmlsZXMgd2l0aGluLlxuICAgIGNvbnN0IGdsb2JPcHRpb25zID0ge1xuICAgICAgZG90OiB0cnVlLFxuICAgICAgbm9kaXI6IHRydWUsXG4gICAgICBmb2xsb3c6IHRydWUsXG4gICAgICBjd2Q6IGRpcmVjdG9yeSxcbiAgICB9O1xuICAgIGNvbnN0IGZpbGVzID0gZ2xvYi5zeW5jKCcqKicsIGdsb2JPcHRpb25zKTsgLy8gVGhlIG91dHB1dCBoZXJlIGlzIGFscmVhZHkgc29ydGVkXG5cbiAgICBjb25zdCBvdXRwdXQgPSBjcmVhdGVXcml0ZVN0cmVhbShvdXRwdXRGaWxlKTtcblxuICAgIGNvbnN0IGFyY2hpdmUgPSBhcmNoaXZlcignemlwJyk7XG4gICAgYXJjaGl2ZS5vbignd2FybmluZycsIGZhaWwpO1xuICAgIGFyY2hpdmUub24oJ2Vycm9yJywgZmFpbCk7XG5cbiAgICAvLyBhcmNoaXZlIGhhcyBiZWVuIGZpbmFsaXplZCBhbmQgdGhlIG91dHB1dCBmaWxlIGRlc2NyaXB0b3IgaGFzIGNsb3NlZCwgcmVzb2x2ZSBwcm9taXNlXG4gICAgLy8gdGhpcyBoYXMgdG8gYmUgZG9uZSBiZWZvcmUgY2FsbGluZyBgZmluYWxpemVgIHNpbmNlIHRoZSBldmVudHMgbWF5IGZpcmUgaW1tZWRpYXRlbHkgYWZ0ZXIuXG4gICAgLy8gc2VlIGh0dHBzOi8vd3d3Lm5wbWpzLmNvbS9wYWNrYWdlL2FyY2hpdmVyXG4gICAgb3V0cHV0Lm9uY2UoJ2Nsb3NlJywgb2spO1xuXG4gICAgYXJjaGl2ZS5waXBlKG91dHB1dCk7XG5cbiAgICAvLyBBcHBlbmQgZmlsZXMgc2VyaWFsbHkgdG8gZW5zdXJlIGZpbGUgb3JkZXJcbiAgICBmb3IgKGNvbnN0IGZpbGUgb2YgZmlsZXMpIHtcbiAgICAgIGNvbnN0IGZ1bGxQYXRoID0gcGF0aC5yZXNvbHZlKGRpcmVjdG9yeSwgZmlsZSk7XG4gICAgICAvLyBFeGFjdGx5IDIgcHJvbWlzZXNcbiAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAY2RrbGFicy9wcm9taXNlYWxsLW5vLXVuYm91bmRlZC1wYXJhbGxlbGlzbVxuICAgICAgY29uc3QgW2RhdGEsIHN0YXRdID0gYXdhaXQgUHJvbWlzZS5hbGwoW2ZzLnJlYWRGaWxlKGZ1bGxQYXRoKSwgZnMuc3RhdChmdWxsUGF0aCldKTtcbiAgICAgIGFyY2hpdmUuYXBwZW5kKGRhdGEsIHtcbiAgICAgICAgbmFtZTogZmlsZSxcbiAgICAgICAgbW9kZTogc3RhdC5tb2RlLFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgYXdhaXQgYXJjaGl2ZS5maW5hbGl6ZSgpO1xuICB9KTtcbn1cblxuLyoqXG4gKiBSZW5hbWUgdGhlIGZpbGUgdG8gdGhlIHRhcmdldCBsb2NhdGlvbiwgdGFraW5nIGludG8gYWNjb3VudDpcbiAqXG4gKiAtIFRoYXQgd2UgbWF5IHNlZSBFUEVSTSBvbiBXaW5kb3dzIHdoaWxlIGFuIEFudGl2aXJ1cyBzY2FubmVyIHN0aWxsIGhhcyB0aGVcbiAqICAgZmlsZSBvcGVuLCBzbyByZXRyeSBhIGNvdXBsZSBvZiB0aW1lcy5cbiAqIC0gVGhpcyBzYW1lIGZ1bmN0aW9uIG1heSBiZSBjYWxsZWQgaW4gcGFyYWxsZWwgYW5kIGJlIGludGVycnVwdGVkIGF0IGFueSBwb2ludC5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gbW92ZUludG9QbGFjZShzb3VyY2U6IHN0cmluZywgdGFyZ2V0OiBzdHJpbmcpIHtcbiAgbGV0IGRlbGF5ID0gMTAwO1xuICBsZXQgYXR0ZW1wdHMgPSA1O1xuICB3aGlsZSAodHJ1ZSkge1xuICAgIHRyeSB7XG4gICAgICAvLyAncmVuYW1lJyBpcyBndWFyYW50ZWVkIHRvIG92ZXJ3cml0ZSBhbiBleGlzdGluZyB0YXJnZXQsIGFzIGxvbmcgYXMgaXQgaXMgYSBmaWxlIChub3QgYSBkaXJlY3RvcnkpXG4gICAgICBhd2FpdCBmcy5yZW5hbWUoc291cmNlLCB0YXJnZXQpO1xuICAgICAgcmV0dXJuO1xuICAgIH0gY2F0Y2ggKGU6IGFueSkge1xuICAgICAgaWYgKGUuY29kZSAhPT0gJ0VQRVJNJyB8fCBhdHRlbXB0cy0tIDw9IDApIHtcbiAgICAgICAgdGhyb3cgZTtcbiAgICAgIH1cbiAgICAgIGVycm9yKGUubWVzc2FnZSk7XG4gICAgICBhd2FpdCBzbGVlcChNYXRoLmZsb29yKE1hdGgucmFuZG9tKCkgKiBkZWxheSkpO1xuICAgICAgZGVsYXkgKj0gMjtcbiAgICB9XG4gIH1cbn1cblxuZnVuY3Rpb24gc2xlZXAobXM6IG51bWJlcikge1xuICByZXR1cm4gbmV3IFByb21pc2Uob2sgPT4gc2V0VGltZW91dChvaywgbXMpKTtcbn1cblxuZnVuY3Rpb24gcmFuZG9tU3RyaW5nKCkge1xuICByZXR1cm4gTWF0aC5yYW5kb20oKS50b1N0cmluZygzNikucmVwbGFjZSgvW15hLXowLTldKy9nLCAnJyk7XG59XG4iXX0=