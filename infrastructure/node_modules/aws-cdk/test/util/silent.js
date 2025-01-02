"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.silentTest = silentTest;
/* eslint-disable jest/no-export */
const logging = require("../../lib/logging");
function silentTest(name, callback, timeout) {
    const spy = jest.spyOn(logging, 'print');
    if (process.env.CLI_TEST_VERBOSE) {
        spy.mockRestore();
    }
    test(name, async () => {
        return callback();
    }, timeout);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2lsZW50LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsic2lsZW50LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBR0EsZ0NBWUM7QUFmRCxtQ0FBbUM7QUFDbkMsNkNBQTZDO0FBRTdDLFNBQWdCLFVBQVUsQ0FBQyxJQUFZLEVBQUUsUUFBb0MsRUFBRSxPQUFnQjtJQUM3RixNQUFNLEdBQUcsR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLE9BQU8sRUFBRSxPQUFPLENBQUMsQ0FBQztJQUN6QyxJQUFJLE9BQU8sQ0FBQyxHQUFHLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQztRQUNqQyxHQUFHLENBQUMsV0FBVyxFQUFFLENBQUM7SUFDcEIsQ0FBQztJQUNELElBQUksQ0FDRixJQUFJLEVBQ0osS0FBSyxJQUFJLEVBQUU7UUFDVCxPQUFPLFFBQVEsRUFBRSxDQUFDO0lBQ3BCLENBQUMsRUFDRCxPQUFPLENBQ1IsQ0FBQztBQUNKLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKiBlc2xpbnQtZGlzYWJsZSBqZXN0L25vLWV4cG9ydCAqL1xuaW1wb3J0ICogYXMgbG9nZ2luZyBmcm9tICcuLi8uLi9saWIvbG9nZ2luZyc7XG5cbmV4cG9ydCBmdW5jdGlvbiBzaWxlbnRUZXN0KG5hbWU6IHN0cmluZywgY2FsbGJhY2s6ICgpID0+IHZvaWQgfCBQcm9taXNlPHZvaWQ+LCB0aW1lb3V0PzogbnVtYmVyKTogdm9pZCB7XG4gIGNvbnN0IHNweSA9IGplc3Quc3B5T24obG9nZ2luZywgJ3ByaW50Jyk7XG4gIGlmIChwcm9jZXNzLmVudi5DTElfVEVTVF9WRVJCT1NFKSB7XG4gICAgc3B5Lm1vY2tSZXN0b3JlKCk7XG4gIH1cbiAgdGVzdChcbiAgICBuYW1lLFxuICAgIGFzeW5jICgpID0+IHtcbiAgICAgIHJldHVybiBjYWxsYmFjaygpO1xuICAgIH0sXG4gICAgdGltZW91dCxcbiAgKTtcbn1cbiJdfQ==