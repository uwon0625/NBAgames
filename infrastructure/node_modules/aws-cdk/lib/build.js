"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildAllStackAssets = buildAllStackAssets;
async function buildAllStackAssets(stacks, options) {
    const { buildStackAssets } = options;
    const buildingErrors = [];
    for (const stack of stacks) {
        try {
            await buildStackAssets(stack);
        }
        catch (err) {
            buildingErrors.push(err);
        }
    }
    if (buildingErrors.length) {
        throw Error(`Building Assets Failed: ${buildingErrors.join(', ')}`);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYnVpbGQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJidWlsZC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQU1BLGtEQWdCQztBQWhCTSxLQUFLLFVBQVUsbUJBQW1CLENBQUMsTUFBMkMsRUFBRSxPQUFnQjtJQUNyRyxNQUFNLEVBQUUsZ0JBQWdCLEVBQUUsR0FBRyxPQUFPLENBQUM7SUFFckMsTUFBTSxjQUFjLEdBQWMsRUFBRSxDQUFDO0lBRXJDLEtBQUssTUFBTSxLQUFLLElBQUksTUFBTSxFQUFFLENBQUM7UUFDM0IsSUFBSSxDQUFDO1lBQ0gsTUFBTSxnQkFBZ0IsQ0FBQyxLQUFLLENBQUMsQ0FBQztRQUNoQyxDQUFDO1FBQUMsT0FBTyxHQUFHLEVBQUUsQ0FBQztZQUNiLGNBQWMsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUM7UUFDM0IsQ0FBQztJQUNILENBQUM7SUFFRCxJQUFJLGNBQWMsQ0FBQyxNQUFNLEVBQUUsQ0FBQztRQUMxQixNQUFNLEtBQUssQ0FBQywyQkFBMkIsY0FBYyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLENBQUM7SUFDdEUsQ0FBQztBQUNILENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjeGFwaSBmcm9tICdAYXdzLWNkay9jeC1hcGknO1xuXG50eXBlIE9wdGlvbnMgPSB7XG4gIGJ1aWxkU3RhY2tBc3NldHM6IChzdGFjazogY3hhcGkuQ2xvdWRGb3JtYXRpb25TdGFja0FydGlmYWN0KSA9PiBQcm9taXNlPHZvaWQ+O1xufTtcblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGJ1aWxkQWxsU3RhY2tBc3NldHMoc3RhY2tzOiBjeGFwaS5DbG91ZEZvcm1hdGlvblN0YWNrQXJ0aWZhY3RbXSwgb3B0aW9uczogT3B0aW9ucyk6IFByb21pc2U8dm9pZD4ge1xuICBjb25zdCB7IGJ1aWxkU3RhY2tBc3NldHMgfSA9IG9wdGlvbnM7XG5cbiAgY29uc3QgYnVpbGRpbmdFcnJvcnM6IHVua25vd25bXSA9IFtdO1xuXG4gIGZvciAoY29uc3Qgc3RhY2sgb2Ygc3RhY2tzKSB7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IGJ1aWxkU3RhY2tBc3NldHMoc3RhY2spO1xuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgYnVpbGRpbmdFcnJvcnMucHVzaChlcnIpO1xuICAgIH1cbiAgfVxuXG4gIGlmIChidWlsZGluZ0Vycm9ycy5sZW5ndGgpIHtcbiAgICB0aHJvdyBFcnJvcihgQnVpbGRpbmcgQXNzZXRzIEZhaWxlZDogJHtidWlsZGluZ0Vycm9ycy5qb2luKCcsICcpfWApO1xuICB9XG59XG4iXX0=