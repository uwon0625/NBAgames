'use client';

import { TeamBoxScore } from '@/types';
import { useMemo } from 'react';

interface BoxScoreTableProps {
  team: TeamBoxScore;
}

export const BoxScoreTable = ({ team }: BoxScoreTableProps) => {
  const getShootingPercentage = (made: number, attempts: number) => {
    if (attempts === 0) return '0.0';
    return ((made / attempts) * 100).toFixed(1);
  };

  const sortedPlayers = useMemo(() => {
    return [...team.players].sort((a, b) => {
      // Sort by minutes played (descending)
      const aMinutes = parseInt(a.minutes.split(':')[0]);
      const bMinutes = parseInt(b.minutes.split(':')[0]);
      if (bMinutes !== aMinutes) return bMinutes - aMinutes;
      
      // Then by points (descending)
      if (b.points !== a.points) return b.points - a.points;
      
      // Then alphabetically by name
      return a.name.localeCompare(b.name);
    });
  }, [team.players]);

  if (!team || !team.players) {
    return (
      <div className="rounded-lg border border-gray-200 p-4 space-y-4">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-48"/>
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <div key={n} className="h-12 bg-gray-100 rounded w-full"/>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 shadow-sm">
      <table className="min-w-full bg-white divide-y divide-gray-200">
        <thead>
          <tr className="bg-gray-50">
            <th className="py-3 px-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider sticky left-0 bg-gray-50 border-b border-gray-200">
              PLAYER
            </th>
            <th className="py-3 px-2 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider border-b border-gray-200">MIN</th>
            <th className="py-3 px-2 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider border-b border-gray-200">PTS</th>
            <th className="py-3 px-2 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider border-b border-gray-200">REB</th>
            <th className="py-3 px-2 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider border-b border-gray-200">AST</th>
            <th className="py-3 px-2 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider border-b border-gray-200">STL</th>
            <th className="py-3 px-2 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider border-b border-gray-200">BLK</th>
            <th className="py-3 px-2 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider border-b border-gray-200">FG</th>
            <th className="py-3 px-2 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider border-b border-gray-200">3P</th>
            <th className="py-3 px-2 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider border-b border-gray-200">FT</th>
            <th className="py-3 px-2 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider border-b border-gray-200">+/-</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 bg-white">
          {sortedPlayers.map((player, idx) => (
            <tr key={player.playerId} 
                className={`hover:bg-blue-50 transition-colors
                  ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
              <td className={`py-2 px-4 text-sm sticky left-0 whitespace-nowrap
                ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}
                hover:bg-blue-50`}>
                <div className="flex items-center space-x-2">
                  <span className="font-medium text-gray-900">{player.name}</span>
                  <span className="px-1.5 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-600">
                    {player.position}
                  </span>
                </div>
              </td>
              <td className="py-2 px-2 text-sm text-right text-gray-600 font-medium tabular-nums">
                {player.minutes}
              </td>
              <td className="py-2 px-2 text-sm text-right text-gray-900 font-semibold tabular-nums">
                {player.points}
              </td>
              <td className="py-2 px-2 text-sm text-right tabular-nums">{player.rebounds}</td>
              <td className="py-2 px-2 text-sm text-right tabular-nums">{player.assists}</td>
              <td className="py-2 px-2 text-sm text-right tabular-nums">{player.steals}</td>
              <td className="py-2 px-2 text-sm text-right tabular-nums">{player.blocks}</td>
              <td className="py-2 px-2 text-sm text-right whitespace-nowrap tabular-nums">
                {player.fgm}-{player.fga}
                <span className="text-gray-500 ml-1">
                  ({getShootingPercentage(player.fgm, player.fga)}%)
                </span>
              </td>
              <td className="py-2 px-2 text-sm text-right whitespace-nowrap tabular-nums">
                {player.threePm}-{player.threePa}
                <span className="text-gray-500 ml-1">
                  ({getShootingPercentage(player.threePm, player.threePa)}%)
                </span>
              </td>
              <td className="py-2 px-2 text-sm text-right whitespace-nowrap tabular-nums">
                {player.ftm}-{player.fta}
                <span className="text-gray-500 ml-1">
                  ({getShootingPercentage(player.ftm, player.fta)}%)
                </span>
              </td>
              <td className={`py-2 px-2 text-sm text-right font-semibold tabular-nums
                ${player.plusMinus > 0 ? 'text-green-600' : 
                  player.plusMinus < 0 ? 'text-red-600' : 'text-gray-500'}`}>
                {player.plusMinus > 0 ? '+' : ''}{player.plusMinus}
              </td>
            </tr>
          ))}
          {/* Team Totals with enhanced styling */}
          <tr className="bg-gray-100 font-medium border-t-2 border-gray-300">
            <td className="py-3 px-4 text-sm sticky left-0 bg-gray-100 text-gray-900 font-semibold">
              Team Totals
            </td>
            <td className="py-3 px-2 text-sm text-right text-gray-500">-</td>
            <td className="py-3 px-2 text-sm text-right text-gray-900 font-semibold tabular-nums">
              {team.totals.points}
            </td>
            <td className="py-3 px-2 text-sm text-right tabular-nums">{team.totals.rebounds}</td>
            <td className="py-3 px-2 text-sm text-right tabular-nums">{team.totals.assists}</td>
            <td className="py-3 px-2 text-sm text-right tabular-nums">{team.totals.steals}</td>
            <td className="py-3 px-2 text-sm text-right tabular-nums">{team.totals.blocks}</td>
            <td className="py-3 px-2 text-sm text-right whitespace-nowrap tabular-nums">
              {team.totals.fgm}-{team.totals.fga}
              <span className="text-gray-500 ml-1">
                ({getShootingPercentage(team.totals.fgm, team.totals.fga)}%)
              </span>
            </td>
            <td className="py-3 px-2 text-sm text-right whitespace-nowrap tabular-nums">
              {team.totals.threePm}-{team.totals.threePa}
              <span className="text-gray-500 ml-1">
                ({getShootingPercentage(team.totals.threePm, team.totals.threePa)}%)
              </span>
            </td>
            <td className="py-3 px-2 text-sm text-right whitespace-nowrap tabular-nums">
              {team.totals.ftm}-{team.totals.fta}
              <span className="text-gray-500 ml-1">
                ({getShootingPercentage(team.totals.ftm, team.totals.fta)}%)
              </span>
            </td>
            <td className="py-3 px-2 text-sm text-right">-</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}; 