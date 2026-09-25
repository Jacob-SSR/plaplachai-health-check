import 'dotenv/config';
import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'./tests/e2e',workers:1,timeout:60000,reporter:'list',use:{baseURL:process.env.APP_ORIGIN??'http://localhost:3000',viewport:{width:1440,height:1000},screenshot:'only-on-failure',trace:'retain-on-failure',launchOptions:process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{}},webServer:process.env.E2E_START_SERVER==='true'?{command:'npm run start',url:'http://localhost:3000/login',reuseExistingServer:false}:undefined});
