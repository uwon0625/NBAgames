"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const cdk_build_tools_1 = require("@aws-cdk/cdk-build-tools");
const account_cache_1 = require("../../lib/api/aws-auth/account-cache");
afterAll(() => {
    cdk_build_tools_1.bockfs.restore();
});
test('uses the resolver when the file cannot be read', async () => {
    const cache = new account_cache_1.AccountAccessKeyCache('/foo/account-cache.json');
    const account = {
        accountId: 'abc',
        partition: 'aws',
    };
    const result = await cache.fetch('abcdef', () => Promise.resolve(account));
    expect(result).toEqual(account);
});
test('gets cached value', async () => {
    const account = {
        accountId: 'xyz',
        partition: 'aws',
    };
    (0, cdk_build_tools_1.bockfs)({
        '/foo/account-cache.json': `${JSON.stringify({
            abcdef: account,
        })}`,
    });
    const cache = new account_cache_1.AccountAccessKeyCache(cdk_build_tools_1.bockfs.path('/foo/account-cache.json'));
    const result = await cache.fetch('abcdef', () => Promise.resolve({
        accountId: 'xyz',
        partition: 'aws',
    }));
    expect(result).toEqual(account);
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYWNjb3VudC1jYWNoZS50ZXN0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiYWNjb3VudC1jYWNoZS50ZXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQUEsOERBQWtEO0FBQ2xELHdFQUE2RTtBQUU3RSxRQUFRLENBQUMsR0FBRyxFQUFFO0lBQ1osd0JBQU0sQ0FBQyxPQUFPLEVBQUUsQ0FBQztBQUNuQixDQUFDLENBQUMsQ0FBQztBQUVILElBQUksQ0FBQyxnREFBZ0QsRUFBRSxLQUFLLElBQUksRUFBRTtJQUNoRSxNQUFNLEtBQUssR0FBRyxJQUFJLHFDQUFxQixDQUFDLHlCQUF5QixDQUFDLENBQUM7SUFDbkUsTUFBTSxPQUFPLEdBQUc7UUFDZCxTQUFTLEVBQUUsS0FBSztRQUNoQixTQUFTLEVBQUUsS0FBSztLQUNqQixDQUFDO0lBQ0YsTUFBTSxNQUFNLEdBQUcsTUFBTSxLQUFLLENBQUMsS0FBSyxDQUFDLFFBQVEsRUFBRSxHQUFHLEVBQUUsQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUM7SUFFM0UsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsQ0FBQztBQUNsQyxDQUFDLENBQUMsQ0FBQztBQUVILElBQUksQ0FBQyxtQkFBbUIsRUFBRSxLQUFLLElBQUksRUFBRTtJQUNuQyxNQUFNLE9BQU8sR0FBRztRQUNkLFNBQVMsRUFBRSxLQUFLO1FBQ2hCLFNBQVMsRUFBRSxLQUFLO0tBQ2pCLENBQUM7SUFFRixJQUFBLHdCQUFNLEVBQUM7UUFDTCx5QkFBeUIsRUFBRSxHQUFHLElBQUksQ0FBQyxTQUFTLENBQUM7WUFDM0MsTUFBTSxFQUFFLE9BQU87U0FDaEIsQ0FBQyxFQUFFO0tBQ0wsQ0FBQyxDQUFDO0lBRUgsTUFBTSxLQUFLLEdBQUcsSUFBSSxxQ0FBcUIsQ0FBQyx3QkFBTSxDQUFDLElBQUksQ0FBQyx5QkFBeUIsQ0FBQyxDQUFDLENBQUM7SUFDaEYsTUFBTSxNQUFNLEdBQUcsTUFBTSxLQUFLLENBQUMsS0FBSyxDQUFDLFFBQVEsRUFBRSxHQUFHLEVBQUUsQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDO1FBQy9ELFNBQVMsRUFBRSxLQUFLO1FBQ2hCLFNBQVMsRUFBRSxLQUFLO0tBQ2pCLENBQUMsQ0FBQyxDQUFDO0lBRUosTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsQ0FBQztBQUNsQyxDQUFDLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IGJvY2tmcyB9IGZyb20gJ0Bhd3MtY2RrL2Nkay1idWlsZC10b29scyc7XG5pbXBvcnQgeyBBY2NvdW50QWNjZXNzS2V5Q2FjaGUgfSBmcm9tICcuLi8uLi9saWIvYXBpL2F3cy1hdXRoL2FjY291bnQtY2FjaGUnO1xuXG5hZnRlckFsbCgoKSA9PiB7XG4gIGJvY2tmcy5yZXN0b3JlKCk7XG59KTtcblxudGVzdCgndXNlcyB0aGUgcmVzb2x2ZXIgd2hlbiB0aGUgZmlsZSBjYW5ub3QgYmUgcmVhZCcsIGFzeW5jICgpID0+IHtcbiAgY29uc3QgY2FjaGUgPSBuZXcgQWNjb3VudEFjY2Vzc0tleUNhY2hlKCcvZm9vL2FjY291bnQtY2FjaGUuanNvbicpO1xuICBjb25zdCBhY2NvdW50ID0ge1xuICAgIGFjY291bnRJZDogJ2FiYycsXG4gICAgcGFydGl0aW9uOiAnYXdzJyxcbiAgfTtcbiAgY29uc3QgcmVzdWx0ID0gYXdhaXQgY2FjaGUuZmV0Y2goJ2FiY2RlZicsICgpID0+IFByb21pc2UucmVzb2x2ZShhY2NvdW50KSk7XG5cbiAgZXhwZWN0KHJlc3VsdCkudG9FcXVhbChhY2NvdW50KTtcbn0pO1xuXG50ZXN0KCdnZXRzIGNhY2hlZCB2YWx1ZScsIGFzeW5jICgpID0+IHtcbiAgY29uc3QgYWNjb3VudCA9IHtcbiAgICBhY2NvdW50SWQ6ICd4eXonLFxuICAgIHBhcnRpdGlvbjogJ2F3cycsXG4gIH07XG5cbiAgYm9ja2ZzKHtcbiAgICAnL2Zvby9hY2NvdW50LWNhY2hlLmpzb24nOiBgJHtKU09OLnN0cmluZ2lmeSh7XG4gICAgICBhYmNkZWY6IGFjY291bnQsXG4gICAgfSl9YCxcbiAgfSk7XG5cbiAgY29uc3QgY2FjaGUgPSBuZXcgQWNjb3VudEFjY2Vzc0tleUNhY2hlKGJvY2tmcy5wYXRoKCcvZm9vL2FjY291bnQtY2FjaGUuanNvbicpKTtcbiAgY29uc3QgcmVzdWx0ID0gYXdhaXQgY2FjaGUuZmV0Y2goJ2FiY2RlZicsICgpID0+IFByb21pc2UucmVzb2x2ZSh7XG4gICAgYWNjb3VudElkOiAneHl6JyxcbiAgICBwYXJ0aXRpb246ICdhd3MnLFxuICB9KSk7XG5cbiAgZXhwZWN0KHJlc3VsdCkudG9FcXVhbChhY2NvdW50KTtcbn0pO1xuIl19